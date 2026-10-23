"use client";

import { AnimatePresence, motion } from "motion/react";
import { Moon, RotateCcw, Sun } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useMedia } from "./App";
import { Mark } from "./Mark";
import { PatientPanel } from "./PatientPanel";
import { PersonaColumn, type InboxItem } from "./PersonaColumn";
import { PHONE, PhoneFrame } from "./PhoneFrame";
import { ReadyList, type ReadyItem } from "./ReadyList";
import { VitalsMonitor } from "./VitalsMonitor";
import { applyEvent, newAssistantTurn, streamAgent, toMessages, turnDirectives, uid, type AssistantTurn, type Turn, type UserTurn } from "@/lib/conversation";
import { FIELD_REPORT, ORDER, PERSONAS, tagged, type PersonaId } from "@/lib/personas";
import { LAST_TICK, TICK_MS, checkTriggers, vitalsAt, vitalsLine, type Vitals } from "@/lib/vitals";

// One case, one agent conversation, three people. Each column shows what its persona said and what
// HealthForce said back; handoffs and tasks in any reply are routed to the right column.

type Note = { id: string; to: PersonaId; from: PersonaId; title: string; at: number };
type Saved = { turns: Turn[]; done: string[]; notes: Note[]; seen: Record<PersonaId, number> };
type Queued = { persona: PersonaId; text: string; auto?: boolean };

const STORE = "hl-team";
const EMPTY_SEEN: Record<PersonaId, number> = { paramedic: 0, doctor: 0, nurse: 0 };

const EMPTY: Record<PersonaId, { title: string; hint: string; prompt?: string }> = {
  paramedic: { title: "Field report", hint: "Tell HealthForce what you see. It finds who this is and alerts the ER before you arrive.", prompt: FIELD_REPORT },
  doctor: { title: "Waiting for Unit 12", hint: "Alerts from the field land here. Ask anything, or tell the nurse what to prepare." },
  nurse: { title: "Bay 4 is clear", hint: "The ready list fills when the doctor asks for something. Tick items off as you go." },
};

// Once an alert lands, the doctor's first question is one tap away.
const ALERTED = {
  doctor: { title: "Unit 12 is minutes out", hint: "Ask HealthForce anything about the incoming patient.", prompt: "What would I miss on this patient? Then get the bay ready for him." },
  nurse: { title: "Get bay 4 ready", hint: "Ask HealthForce what this patient needs before arrival.", prompt: "What should I prepare before he arrives? Any allergies or access issues?" },
} as const;

function load(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as Saved | null;
    if (saved?.turns) return { ...saved, seen: { ...EMPTY_SEEN, ...saved.seen } };
  } catch {}
  return { turns: [], done: [], notes: [], seen: EMPTY_SEEN };
}

/** A short two-tone chime when an alert lands, so the doctor hears it across the room. */
function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.14 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.14);
      osc.stop(ctx.currentTime + i * 0.14 + 0.4);
    });
  } catch {}
}

export function TeamApp() {
  const [initial] = useState(load);
  const [turns, setTurns] = useState<Turn[]>(initial.turns);
  const [done, setDone] = useState<string[]>(initial.done);
  const [notes, setNotes] = useState<Note[]>(initial.notes);
  const [seen, setSeen] = useState(initial.seen);
  const [queue, setQueue] = useState<Queued[]>([]);
  const queueRef = useRef<Queued[]>([]);
  const draining = useRef(false);
  const [running, setRunning] = useState<PersonaId | null>(null);
  const [chartOpen, setChartOpen] = useState(false);
  const [tab, setTab] = useState<PersonaId>("paramedic");
  const [theme, setTheme] = useState<"light" | "dark">(() => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
  const turnsRef = useRef(turns);
  const pending = useRef<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  // On a real phone, one persona at a time; anywhere bigger, three identical phones scaled together.
  const narrow = useMedia("(max-width: 760px)");
  const stage = useRef<HTMLDivElement>(null);
  // Fill the screen: the three phones share the width equally, the scale follows from that (so text
  // grows on big screens), and the phone height stretches to whatever height is left.
  const [scale, setScale] = useState(1);
  const rowWidth = 3 * PHONE.width + 2 * PHONE.gap;
  const rowHeight = PHONE.height + PHONE.label;

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      setScale(Math.min(1.6, (el.clientWidth - 48) / rowWidth, (el.clientHeight - 24) / rowHeight));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [rowWidth, rowHeight, narrow]);

  // The ambulance monitor: starts with the field report, alarms go to the agent like any message.
  const [vitals, setVitals] = useState<Vitals[]>([]);
  const [feedOn, setFeedOn] = useState(false);
  const [fast, setFast] = useState(false);
  const [alarms, setAlarms] = useState<string[]>([]);
  const vitalsRef = useRef<Vitals[]>([]);
  const fired = useRef<string[]>([]);
  const sendRef = useRef<(q: Queued) => void>(() => {});

  useEffect(() => {
    if (!feedOn) return;
    const timer = setInterval(() => {
      const next = vitalsRef.current.length;
      if (next > LAST_TICK) {
        setFeedOn(false);
        return;
      }
      const history = [...vitalsRef.current, vitalsAt(next)];
      vitalsRef.current = history;
      setVitals(history);
      for (const t of checkTriggers(history, fired.current)) {
        fired.current = [...fired.current, t.id];
        setAlarms((a) => [...a, t.label]);
        sendRef.current({ persona: "paramedic", text: t.message, auto: true });
      }
    }, fast ? TICK_MS / 3 : TICK_MS);
    return () => clearInterval(timer);
  }, [feedOn, fast]);

  useEffect(() => {
    if (!running) localStorage.setItem(STORE, JSON.stringify({ turns, done, notes, seen } satisfies Saved));
  }, [turns, done, notes, seen, running]);

  // Everything HealthForce asked the team to do, read from its replies.
  const routed = useMemo(() => {
    const inbox: Record<PersonaId, InboxItem[]> = { paramedic: [], doctor: [], nurse: [] };
    const ready: ReadyItem[] = [];
    const asked = new Set<string>();
    for (const turn of turns) {
      if (turn.role !== "assistant") continue;
      const d = turnDirectives(turn);
      const from = turn.replyTo ? PERSONAS[turn.replyTo].name : "HealthForce";
      d.handoffs.forEach((h, i) =>
        inbox[h.to].push({ id: `${turn.id}-h${i}`, from: `HealthForce · ${from}`, priority: h.priority, title: h.title, summary: h.summary, at: Number(turn.id.split(":")[1] ?? 0) }),
      );
      d.tasks.forEach((t, ti) =>
        t.items.forEach((item, i) => {
          if (t.to !== "nurse") {
            inbox[t.to].push({ id: `${turn.id}-t${ti}-${i}`, from: "HealthForce", priority: "routine", title: item.task, summary: item.why, at: Number(turn.id.split(":")[1] ?? 0) });
            return;
          }
          // Later replies often restate earlier tasks; keep the first.
          const key = item.task.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 40);
          if (asked.has(key)) return;
          asked.add(key);
          const id = `${turn.id}-t${ti}-${i}`;
          ready.push({ id, task: item.task, why: item.why, done: done.includes(id) });
        }),
      );
    }
    for (const n of notes) inbox[n.to].push({ id: n.id, from: PERSONAS[n.from].name, priority: "routine", title: n.title, at: n.at });
    return { inbox, ready };
  }, [turns, done, notes]);

  // Alert a column when something new lands in its inbox.
  // New ready-list items count as alerts for the nurse.
  const counts = useMemo(
    () => Object.fromEntries(ORDER.map((p) => [p, routed.inbox[p].length + (p === "nurse" ? routed.ready.length : 0)])) as Record<PersonaId, number>,
    [routed],
  );
  const lastCounts = useRef(counts);
  useEffect(() => {
    const urgent = (p: PersonaId) => (p === "nurse" && counts.nurse - lastCounts.current.nurse > 0) || routed.inbox[p].at(-1)?.priority !== "routine";
    if (ORDER.some((p) => counts[p] > lastCounts.current[p] && urgent(p))) chime();
    lastCounts.current = counts;
  }, [counts, routed]);
  const fresh = (p: PersonaId) => counts[p] > seen[p];
  const ack = (p: PersonaId) => counts[p] > seen[p] && setSeen((s) => ({ ...s, [p]: counts[p] }));

  const patient = useMemo(
    () => [...turns].reverse().find((t): t is AssistantTurn => t.role === "assistant" && !!t.patient)?.patient,
    [turns],
  );

  // The ref is the source of truth for queued runs, which start before React re-renders.
  const commit = useCallback((next: Turn[]) => {
    turnsRef.current = next;
    setTurns(next);
  }, []);
  const patch = useCallback((turn: AssistantTurn) => commit(turnsRef.current.map((t) => (t.id === turn.id ? turn : t))), [commit]);

  const run = useCallback(async ({ persona, text, auto }: Queued) => {
    const prior = turnsRef.current;
    const first = !prior.some((t) => t.role === "user");
    // Humans' messages carry the latest monitor reading so answers use current vitals.
    const reading = !auto && vitalsRef.current.length ? vitalsLine(vitalsRef.current) : null;
    const updates = [...pending.current, ...(reading ? [reading] : [])];
    const user: UserTurn = { id: uid(), role: "user", persona, text, auto, sent: tagged(persona, text, updates, first, auto) };
    pending.current = [];
    let reply: AssistantTurn = { ...newAssistantTurn(), id: `${uid()}:${Date.now()}`, replyTo: persona };
    commit([...prior, user, reply]);

    const controller = new AbortController();
    abort.current = controller;
    setRunning(persona);
    try {
      await streamAgent(
        toMessages([...prior, user]),
        (event, data) => {
          reply = applyEvent(reply, event, data);
          patch(reply);
        },
        controller.signal,
      );
      if (reply.status === "streaming") reply = { ...reply, status: "error", error: "The agent stopped before answering. Try again." };
    } catch (e) {
      const stopped = (e as Error).name === "AbortError";
      reply = { ...reply, status: "error", error: stopped ? "Stopped." : (e as Error).message };
    } finally {
      reply = { ...reply, steps: reply.steps.map((s) => (s.status === "run" ? { ...s, status: "error" } : s)) };
      patch(reply);
      setRunning(null);
    }
  }, [commit, patch]);

  // One agent run at a time; messages from the other columns wait their turn.
  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    while (queueRef.current.length) {
      const head = queueRef.current.shift()!;
      setQueue([...queueRef.current]);
      await run(head);
    }
    draining.current = false;
  }, [run]);

  const enqueue = (q: Queued) => {
    queueRef.current.push(q);
    setQueue([...queueRef.current]);
    drain();
  };
  useEffect(() => {
    sendRef.current = enqueue;
  });

  const send = (persona: PersonaId, text: string) => {
    if (persona === "paramedic" && !vitalsRef.current.length) {
      vitalsRef.current = [vitalsAt(0)];
      setVitals(vitalsRef.current);
      setFeedOn(true);
    }
    enqueue({ persona, text });
  };

  const toggleTask = (id: string) => {
    const item = routed.ready.find((r) => r.id === id);
    if (!item) return;
    if (done.includes(id)) {
      setDone((d) => d.filter((x) => x !== id));
      return;
    }
    setDone((d) => [...d, id]);
    const title = `Ready: ${item.task}`;
    setNotes((n) => [...n, { id: uid(), to: "doctor", from: "nurse", title, at: Date.now() }]);
    pending.current.push(`${PERSONAS.nurse.name} marked ready: ${item.task}`);
  };

  const reset = () => {
    queueRef.current = [];
    vitalsRef.current = [];
    fired.current = [];
    setVitals([]);
    setAlarms([]);
    setFeedOn(false);
    abort.current?.abort();
    setQueue([]);
    commit([]);
    setDone([]);
    setNotes([]);
    setSeen(EMPTY_SEEN);
    setChartOpen(false);
    pending.current = [];
    lastCounts.current = { paramedic: 0, doctor: 0, nurse: 0 };
  };

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("hl-theme", next);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName);
      if (!typing && !e.metaKey && !e.ctrlKey && e.key === "d") toggleTheme();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [toggleTheme]);

  const column = (p: PersonaId) => {
    const own = turns.filter((t) => (t.role === "user" ? t.persona === p : t.replyTo === p));
    const body = (
      <PersonaColumn
        key={p}
        persona={PERSONAS[p]}
        turns={own}
        busy={!!running}
        running={running === p}
        queued={queue.filter((q) => q.persona === p).length}
        inbox={routed.inbox[p]}
        empty={p !== "paramedic" && counts[p] ? ALERTED[p] : EMPTY[p]}
        onAck={() => ack(p)}
        onSend={(text) => send(p, text)}
        onStop={() => abort.current?.abort()}
        onChart={p === "doctor" && patient ? () => setChartOpen((o) => !o) : undefined}
      >
        {p === "paramedic" && (
          <VitalsMonitor history={vitals} running={feedOn} fast={fast} alarms={alarms} onToggle={() => setFeedOn((o) => !o)} onFast={() => setFast((f) => !f)} />
        )}
        {p === "nurse" && <ReadyList items={routed.ready} onToggle={toggleTask} />}
        {p === "doctor" && (
          <AnimatePresence>
            {chartOpen && patient && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-x-0 top-[52px] bottom-0 z-20 overflow-y-auto border-t border-line bg-raise"
              >
                <PatientPanel chart={patient} identified clinician={PERSONAS.doctor.name} onClose={() => setChartOpen(false)} />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </PersonaColumn>
    );
    if (narrow) return <div key={p} data-persona={p} className="flex min-h-0 flex-1 flex-col">{body}</div>;
    return (
      <PhoneFrame key={p} persona={PERSONAS[p]} fresh={fresh(p)}>
        {body}
      </PhoneFrame>
    );
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-[50px] flex-none items-center gap-4 border-b border-line px-5">
        <Link href="/" className="flex items-center gap-2.5 font-serif text-[24px] leading-none tracking-[-.01em]">
          <Mark className="size-[20px]" />
          HealthForce
        </Link>
        <AnimatePresence>
          {patient && (
            <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="min-w-0 truncate text-[15px] text-mute">
              Unit 12 patient: most likely <span className="font-normal text-ink">{patient.name}</span>
            </motion.span>
          )}
        </AnimatePresence>
        <div className="ml-auto flex items-center gap-1.5 text-mute">
          <span className="inline-flex items-center gap-[7px] rounded-full border border-line px-[11px] py-1.5 font-mono text-[10.5px] leading-none tracking-[.07em] whitespace-nowrap uppercase max-sm:hidden">
            <span className={clsx("size-1.5 rounded-full bg-accent", running ? "animate-[pulse-dot_0.8s_infinite]" : "animate-[pulse-dot_2s_infinite]")} />
            One Cortex Agent · 3 people
          </span>
          <button onClick={reset} title="New case" className="rounded-[9px] p-2 hover:bg-line hover:text-ink">
            <RotateCcw className="size-[18px]" strokeWidth={1.5} />
          </button>
          <button onClick={toggleTheme} title="Dark / light (d)" className="rounded-[9px] p-2 hover:bg-line hover:text-ink">
            {theme === "dark" ? <Sun className="size-[18px]" strokeWidth={1.5} /> : <Moon className="size-[18px]" strokeWidth={1.5} />}
          </button>
        </div>
      </header>

      {narrow && (
        <nav className="flex flex-none border-b border-line">
          {ORDER.map((p) => (
            <button
              key={p}
              onClick={() => {
                setTab(p);
                ack(p);
              }}
              className={clsx("relative flex-1 py-2.5 text-[14px]", tab === p ? "font-normal" : "text-mute")}
              style={tab === p ? { boxShadow: `inset 0 -2px 0 ${PERSONAS[p].tint}` } : undefined}
            >
              {PERSONAS[p].role}
              {fresh(p) && tab !== p && <span className="absolute top-2 ml-1 size-1.5 animate-[pulse-dot_1s_infinite] rounded-full bg-accent" />}
            </button>
          ))}
        </nav>
      )}

      {narrow ? (
        <main className="flex min-h-0 flex-1 flex-col">{column(tab)}</main>
      ) : (
        <main ref={stage} className="grid min-h-0 flex-1 place-items-center overflow-hidden">
          <div style={{ width: rowWidth * scale, height: rowHeight * scale }}>
            <div className="flex origin-top-left" style={{ width: rowWidth, gap: PHONE.gap, transform: `scale(${scale})` }}>
              {ORDER.map(column)}
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
