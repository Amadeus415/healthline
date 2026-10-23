"use client";

import { AnimatePresence, motion } from "motion/react";
import { Ambulance, PanelLeft, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Composer } from "../Composer";
import { Thread } from "../Thread";
import { BriefView } from "./Brief";
import { CloseView } from "./Close";
import { CluesView } from "./Clues";
import { MatchView } from "./Match";
import { ease } from "./parts";
import { RadioView } from "./Radio";
import { RecordView } from "./Record";
import { applyEvent, newAssistantTurn, streamAgent, toMessages, uid, type AssistantTurn, type Turn } from "@/lib/conversation";
import { cluesFromParse, ETA_SECONDS, hms, mergeArgs, mmss, RADIO, secondsOfDay, SPEED, VISIBLE, type Clue } from "@/lib/inbound";
import type { Brief, Candidate, IdentifyResult, NextQuestion, ParsedClues, Stats } from "@/lib/types";

const STAGES = [
  { name: "Inbound", persona: "Paramedic" },
  { name: "Clues", persona: "Paramedic" },
  { name: "Match", persona: "Triage nurse" },
  { name: "Record", persona: "Data layer" },
  { name: "Brief", persona: "ER doctor" },
  { name: "Ask", persona: "ER doctor" },
  { name: "Handoff", persona: "Healthline" },
];

const QUESTIONS = ["Has she had a head scan before?", "What has this ER given her for pain before?", "Any history of falls or bleeding?"];

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("stopped", "AbortError"))), { once: true });
  });

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

type Props = { active: boolean; sidebarHidden: boolean; onShowSidebar: () => void };

/** The ambulance countdown, live: identify an unknown patient from what the paramedic sees,
 * pull her record together, and brief the ER before she arrives. */
export function Inbound({ active, sidebarHidden, onShowSidebar }: Props) {
  const [stage, setStage] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [heard, setHeard] = useState<Clue[]>([]);
  const [complaint, setComplaint] = useState("");
  const [parsing, setParsing] = useState(false);
  const [clues, setClues] = useState<Clue[]>([]);
  const [result, setResult] = useState<IdentifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmed, setConfirmed] = useState<{ patient_id: number; at: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  // The autoplay script outlives the render it started in, so it reads these through refs.
  const cluesRef = useRef<Clue[]>([]);
  const startedRef = useRef<number | null>(null);
  const complaintRef = useRef("");
  const briefRef = useRef<Promise<Brief> | null>(null);
  const script = useRef<AbortController | null>(null);

  const metro = stats?.metro ?? "Cleveland";
  const t0 = stats ? secondsOfDay(stats.as_of) : 6 * 3600 + 21 * 60 + 14;
  const elapsed = startedAt ? Math.max(0, ((now || startedAt) - startedAt) / 1000) * SPEED : 0;
  const eta = Math.max(0, ETA_SECONDS - elapsed);
  const story = t0 + elapsed;

  useEffect(() => {
    if (!active || stats) return;
    fetch("/api/stats")
      .then((r) => r.json())
      .then((j) => !j.error && setStats(j))
      .catch(() => {});
  }, [active, stats]);

  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [startedAt]);

  // Clue kinds already reported, whether answered, volunteered or typed.
  const used = new Set(clues.flatMap((c) => (c.kind ? [c.kind] : [])));
  if (clues.some((c) => c.args.zip)) used.add("zip");
  if (clues.some((c) => c.args.height_min)) used.add("height");
  if (clues.some((c) => c.args.medications)) used.add("medication");
  if (clues.some((c) => c.args.first_initial || c.args.name)) used.add("first_initial");

  const identify = async (next: Clue[]) => {
    cluesRef.current = next;
    setClues(next);
    setLoading(true);
    setError(undefined);
    try {
      const r = await post<IdentifyResult>("/api/identify", mergeArgs(next, metro));
      setResult(r);
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const play = async () => {
    if (startedRef.current) return heard;
    startedRef.current = Date.now();
    setStartedAt(startedRef.current);
    setNow(Date.now());
    setParsing(true);
    try {
      const parsed = await post<ParsedClues>("/api/clues", { text: RADIO });
      const found = cluesFromParse(parsed, "radio", uid);
      setHeard(found);
      complaintRef.current = parsed.complaint ?? "";
      setComplaint(complaintRef.current);
      return found;
    } catch (e) {
      setError((e as Error).message);
      return [];
    } finally {
      setParsing(false);
    }
  };

  const startSearch = (from: Clue[] = heard) => {
    setStage(1);
    if (!cluesRef.current.length) return identify(from);
    return Promise.resolve(result);
  };

  const answer = (kind: NextQuestion["clue"]) => {
    const seen = VISIBLE[kind];
    if (!seen) return Promise.resolve(result);
    return identify([...cluesRef.current, { ...seen, id: uid(), from: "paramedic", kind }]);
  };

  const typed = async (text: string) => {
    setParsing(true);
    try {
      const parsed = await post<ParsedClues>("/api/clues", { text });
      const found = cluesFromParse(parsed, "typed", uid);
      if (found.length) await identify([...cluesRef.current, ...found]);
      else setError("Claude couldn't find a clue in that. Try a height, a drug name or an initial.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setParsing(false);
    }
  };

  const confirm = async (c: Candidate) => {
    setConfirming(true);
    const at = hms(t0 + (startedRef.current ? ((Date.now() - startedRef.current) / 1000) * SPEED : 0)).slice(0, 5);
    // Start the record right away; the nurse's click and the brief run side by side.
    briefRef.current = post<Brief>("/api/brief", { patientId: c.patient_id, complaint: complaintRef.current || "Fall with head strike" });
    briefRef.current.then(setBrief).catch((e) => setError((e as Error).message));
    try {
      await post("/api/confirm", { patientId: c.patient_id, probability: c.probability, clues: mergeArgs(cluesRef.current, metro), clinician: "Triage nurse", role: "triage" });
    } catch {
      // The log is an audit trail; a failed write shouldn't stop the brief.
    }
    setConfirmed({ patient_id: c.patient_id, at });
    setConfirming(false);
  };

  const ask = async (text: string, about: Brief | null = brief) => {
    if (busy || !about) return;
    const p = about.patient;
    const user: Turn = {
      id: uid(),
      role: "user",
      text,
      context: `Context: Medic 14's patient has just been identified by the triage nurse as ${p.name} (patient_id ${p.patient_id}, ${p.age}, ${p.gender}). She is arriving at this ER with: ${about.complaint}. The question is about her.`,
    };
    let reply = newAssistantTurn();
    const prior = turns;
    setTurns([...prior, user, reply]);
    setBusy(true);
    const patch = (t: AssistantTurn) => setTurns((all) => all.map((x) => (x.id === t.id ? t : x)));
    try {
      await streamAgent(toMessages([...prior, user]), (event, data) => {
        reply = applyEvent(reply, event, data);
        patch(reply);
      });
      if (reply.status === "streaming") reply = { ...reply, status: "error", error: "The agent stopped before answering. Try again." };
    } catch (e) {
      reply = { ...reply, status: "error", error: (e as Error).message };
    } finally {
      reply = { ...reply, steps: reply.steps.map((s) => (s.status === "run" ? { ...s, status: "error" } : s)) };
      patch(reply);
      setBusy(false);
    }
  };

  const restart = () => {
    script.current?.abort();
    setAutoplay(false);
    setStage(0);
    setStartedAt(null);
    startedRef.current = null;
    complaintRef.current = "";
    setNow(0);
    setHeard([]);
    setComplaint("");
    setClues([]);
    cluesRef.current = [];
    setResult(null);
    setError(undefined);
    setConfirmed(null);
    setBrief(null);
    briefRef.current = null;
    setTurns([]);
  };

  // Autoplay drives the same handlers a presenter would click, against live data.
  const run = async (signal: AbortSignal) => {
    const found = await play();
    await sleep(5200, signal);
    let r = await startSearch(found.length ? found : heard);
    await sleep(2600, signal);
    for (const kind of ["zip", "height"] as const) {
      if (!cluesRef.current.some((c) => (kind === "zip" ? c.args.zip : c.args.height_min))) {
        r = await answer(kind);
        await sleep(2600, signal);
      }
    }
    for (let i = 0; i < 4 && r && !r.leader && r.total_matches > 5; i++) {
      const q = r.next_questions?.find((x) => VISIBLE[x.clue] && !cluesRef.current.some((c) => c.kind === x.clue));
      if (!q) break;
      await sleep(3800, signal);
      r = await answer(q.clue);
      await sleep(2400, signal);
    }
    if (!r?.candidates[0]) return;
    setStage(2);
    await sleep(5500, signal);
    await confirm(r.candidates[0]);
    await sleep(2400, signal);
    const b = await briefRef.current;
    setStage(3);
    await sleep(9500, signal);
    setStage(4);
    await sleep(11000, signal);
    if (!b) return;
    setStage(5);
    await sleep(1200, signal);
    await ask(QUESTIONS[0], b);
    await sleep(7000, signal);
    setStage(6);
  };

  const toggleAutoplay = () => {
    if (autoplay) {
      script.current?.abort();
      setAutoplay(false);
      return;
    }
    const controller = new AbortController();
    script.current = controller;
    setAutoplay(true);
    run(controller.signal)
      .catch(() => {})
      .finally(() => !controller.signal.aborted && setAutoplay(false));
  };

  const reachable = (i: number) =>
    i === 0 ||
    (i === 1 && !!startedAt) ||
    (i === 2 && !!result && result.total_matches > 0 && result.total_matches <= 25) ||
    (i >= 3 && !!confirmed && (i === 3 || !!brief));

  const goto = (i: number) => {
    if (!reachable(i)) return;
    if (autoplay) {
      script.current?.abort();
      setAutoplay(false);
    }
    if (i === 1) startSearch();
    else setStage(i);
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") goto(stage + 1);
      if (e.key === "ArrowLeft") goto(stage - 1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const urgent = startedAt && eta > 0 && eta <= 90;
  const arrived = startedAt && eta === 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="flex h-[58px] flex-none items-center gap-4 border-b border-line px-6">
        {sidebarHidden && (
          <button onClick={onShowSidebar} title="Show sidebar" className="rounded-[9px] p-2 text-mute hover:bg-line hover:text-ink">
            <PanelLeft className="size-[18px]" strokeWidth={1.5} />
          </button>
        )}
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="label">Bay 6</span>
          <span className="truncate text-[16px] font-normal">
            Medic 14
            <AnimatePresence>
              {confirmed && brief && (
                <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}>
                  <span className="mx-1.5 text-mute">→</span>
                  {brief.patient.name}
                </motion.span>
              )}
            </AnimatePresence>
          </span>
          <motion.span
            key={STAGES[stage].persona}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-full border border-edge px-2.5 py-1 font-mono text-[10px] leading-none tracking-[.07em] uppercase max-md:hidden"
          >
            {STAGES[stage].persona}
          </motion.span>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          <span className="font-mono text-[12px] tracking-[.03em] text-mute tabular-nums max-lg:hidden">Mon 23 Sep 2024 · {hms(story)}</span>
          <span
            className={clsx(
              "inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[11.5px] leading-none tracking-[.04em] tabular-nums transition-colors duration-500",
              arrived ? "bg-ink text-paper" : urgent ? "bg-accent text-white" : "bg-accent-soft text-accent",
            )}
          >
            <Ambulance className="size-3.5" strokeWidth={1.6} />
            {arrived ? `Arrived ${hms(t0 + ETA_SECONDS).slice(0, 5)}` : `ETA ${mmss(eta)}`}
          </span>
          <button
            onClick={toggleAutoplay}
            title={autoplay ? "Pause the demo" : "Play the whole demo"}
            className={clsx("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px]", autoplay ? "border-ink" : "border-edge hover:border-ink")}
          >
            {autoplay ? <Pause className="size-3.5" strokeWidth={1.8} /> : <Play className="size-3.5" strokeWidth={1.8} />}
            {autoplay ? "Pause" : "Autoplay"}
          </button>
          <button onClick={restart} title="Start over" className="rounded-[9px] p-2 text-mute hover:bg-line hover:text-ink">
            <RotateCcw className="size-4" strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <nav className="flex flex-none items-center gap-1 overflow-x-auto border-b border-line px-6 py-2.5">
        {STAGES.map((s, i) => {
          const can = reachable(i);
          return (
            <button
              key={s.name}
              disabled={!can}
              onClick={() => goto(i)}
              className={clsx(
                "group flex items-center gap-2 rounded-full px-3 py-1.5 text-[13.5px] whitespace-nowrap transition-colors",
                i === stage ? "bg-raise shadow-[inset_0_0_0_1px_var(--line)]" : can ? "hover:bg-line" : "text-mute/60",
              )}
            >
              <span
                className={clsx(
                  "grid size-[18px] place-items-center rounded-full font-mono text-[9.5px]",
                  i === stage ? "bg-accent text-white" : i < stage ? "bg-ink text-paper" : "border border-edge",
                )}
              >
                {i + 1}
              </span>
              {s.name}
            </button>
          );
        })}
      </nav>

      {stage === 5 && brief ? (
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="flex-none px-6 pt-6">
            <div className="mx-auto flex max-w-[760px] flex-wrap items-center gap-2">
              <span className="label mr-2">Ask about {brief.patient.first_name} · {brief.sites.length} care sites</span>
              {QUESTIONS.map((q) => (
                <button key={q} disabled={busy} onClick={() => ask(q)} className="rounded-full border border-edge px-3 py-1.5 text-[13.5px] hover:border-ink disabled:opacity-50">
                  {q}
                </button>
              ))}
            </div>
          </div>
          <Thread turns={turns} busy={busy} onReply={ask} />
          <div className="flex-none bg-[linear-gradient(to_bottom,transparent,var(--paper)_30%)] px-6 pb-[18px]">
            <div className="mx-auto max-w-[760px]">
              <Composer placeholder={`Ask anything about ${brief.patient.first_name}`} onSend={ask} busy={busy} />
            </div>
          </div>
        </section>
      ) : (
        <section className="min-h-0 flex-1 overflow-y-auto px-6 py-8 md:px-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={stage}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.45, ease }}
              className="mx-auto w-full max-w-[1180px]"
            >
              {stage === 0 && <RadioView started={!!startedAt} heard={heard} complaint={complaint} parsing={parsing} onPlay={play} onNext={() => startSearch()} />}
              {stage === 1 && (
                <CluesView
                  clues={clues}
                  result={result}
                  loading={loading}
                  parsing={parsing}
                  error={error}
                  metro={metro}
                  used={used}
                  onAnswer={answer}
                  onTyped={typed}
                  onNext={() => goto(2)}
                />
              )}
              {stage === 2 && result && <MatchView result={result} stats={stats} confirmed={confirmed} confirming={confirming} onConfirm={confirm} />}
              {stage === 2 && confirmed && <NextButton label={brief ? "Pull her record together" : "Pulling her record…"} disabled={!brief} onClick={() => goto(3)} />}
              {stage === 3 && brief && (
                <>
                  <RecordView brief={brief} />
                  <NextButton label="Brief the trauma bay" onClick={() => goto(4)} />
                </>
              )}
              {stage === 4 && brief && (
                <>
                  <BriefView brief={brief} confirmedAt={confirmed?.at} eta={startedAt ? eta : undefined} />
                  <NextButton label="Ask a follow-up" onClick={() => goto(5)} />
                </>
              )}
              {stage === 6 && (
                <CloseView
                  stats={stats}
                  searched={result?.funnel[0]?.count ?? 0}
                  clues={clues.length}
                  brief={brief}
                  beforeArrival={!arrived}
                  onRestart={restart}
                />
              )}
              {(stage === 3 || stage === 4) && !brief && <p className="text-mute">Pulling her record together…</p>}
            </motion.div>
          </AnimatePresence>
        </section>
      )}
      {stage === 5 && (
        <button onClick={() => goto(6)} className="absolute right-6 bottom-24 rounded-full border border-edge bg-raise px-3.5 py-2 text-[13px] hover:border-ink max-md:hidden">
          Hand off →
        </button>
      )}
    </div>
  );
}

function NextButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="flex justify-end pt-8">
      <button
        disabled={disabled}
        onClick={onClick}
        className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[15px] text-paper transition-opacity disabled:opacity-40"
      >
        {label} →
      </button>
    </div>
  );
}
