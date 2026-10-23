"use client";

import { AnimatePresence, motion } from "motion/react";
import { PanelLeft, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import clsx from "clsx";
import { Composer, type ComposerHandle } from "./Composer";
import { Home } from "./Home";
import { Inbound } from "./inbound/Inbound";
import { PatientPanel } from "./PatientPanel";
import { Sidebar } from "./Sidebar";
import { Thread } from "./Thread";
import { applyEvent, newAssistantTurn, streamAgent, toMessages, uid, type AssistantTurn, type Turn } from "@/lib/conversation";
import type { Bay } from "@/lib/types";

type Case = { id: string; title: string; bay?: number; label?: string; unidentified?: boolean; turns: Turn[]; updatedAt: number };

const STORE = "hl-cases";
const CLINICIAN = "Dr. Okafor";

function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const mq = matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
  );
}

function loadCases(): Case[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "[]");
  } catch {
    return [];
  }
}

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
  const [bays, setBays] = useState<Bay[]>([]);
  const [boardError, setBoardError] = useState<string>();
  const [cases, setCases] = useState<Case[]>(loadCases);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [homeBay, setHomeBay] = useState<Bay>();
  const [panelOpen, setPanelOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  // The ambulance workflow opens first: it's the demo. ?view=chat starts in the assistant.
  const [view, setView] = useState<"chat" | "inbound">(() => (new URLSearchParams(location.search).get("view") === "chat" ? "chat" : "inbound"));
  const abort = useRef<AbortController | null>(null);
  const homeComposer = useRef<ComposerHandle>(null);
  const caseComposer = useRef<ComposerHandle>(null);
  const narrow = useMedia("(max-width: 1220px)");
  const phone = useMedia("(max-width: 760px)");

  // The live ER board.
  useEffect(() => {
    fetch("/api/board")
      .then((r) => r.json())
      .then((j) => {
        setBays(j.bays ?? []);
        if (j.error) setBoardError(j.error);
        setHomeBay((current) => current ?? (j.bays as Bay[] | undefined)?.find((b) => !b.patient_id));
      })
      .catch((e) => setBoardError(String(e)));
  }, []);

  useEffect(() => {
    if (!busy) localStorage.setItem(STORE, JSON.stringify(cases.slice(0, 20)));
  }, [cases, busy]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("hl-theme", next);
      return next;
    });
  }, []);

  const active = cases.find((c) => c.id === activeId) ?? null;
  const patient = useMemo(
    () => [...(active?.turns ?? [])].reverse().find((t): t is AssistantTurn => t.role === "assistant" && !!t.patient)?.patient,
    [active],
  );

  const newCase = useCallback(() => {
    abort.current?.abort();
    setView("chat");
    setActiveId(null);
    setPanelOpen(false);
    setHomeBay(bays.find((b) => !b.patient_id));
    requestAnimationFrame(() => homeComposer.current?.focus());
  }, [bays]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        newCase();
        return;
      }
      const typing = e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName);
      if (!typing && !e.metaKey && !e.ctrlKey && e.key === "d") toggleTheme();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [newCase, toggleTheme]);

  const patchTurn = (caseId: string, turn: AssistantTurn) =>
    setCases((all) => all.map((c) => (c.id === caseId ? { ...c, updatedAt: Date.now(), turns: c.turns.map((t) => (t.id === turn.id ? turn : t)) } : c)));

  const send = async (text: string, opts: { caseId?: string | null; bay?: Bay } = {}) => {
    if (busy) return;
    let caseId = opts.caseId === undefined ? activeId : opts.caseId;
    let prior: Turn[] = cases.find((c) => c.id === caseId)?.turns ?? [];

    setView("chat");
    if (!caseId) {
      const named = text.match(/\bbay (\d+)\b/i);
      const bay = opts.bay ?? bays.find((b) => named && b.bay === Number(named[1]));
      const fresh: Case = {
        id: uid(),
        title: bay ? `Bay ${bay.bay}` : text.length > 44 ? `${text.slice(0, 44).trim()}…` : text,
        bay: bay?.bay,
        label: bay?.patient,
        unidentified: bay ? !bay.patient_id : /unconscious|unknown|unidentified|unresponsive/i.test(text),
        turns: [],
        updatedAt: Date.now(),
      };
      caseId = fresh.id;
      prior = [];
      setCases((all) => [fresh, ...all]);
      setActiveId(fresh.id);
      setPanelOpen(false);
    }

    const user: Turn = { id: uid(), role: "user", text };
    let reply = newAssistantTurn();
    const id = caseId;
    setCases((all) => all.map((c) => (c.id === id ? { ...c, updatedAt: Date.now(), turns: [...c.turns, user, reply] } : c)));

    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    try {
      await streamAgent(
        toMessages([...prior, user]),
        (event, data) => {
          const hadPatient = !!reply.patient;
          reply = applyEvent(reply, event, data);
          patchTurn(id, reply);
          if (!hadPatient && reply.patient) setPanelOpen(true);
        },
        controller.signal,
      );
      if (reply.status === "streaming") reply = { ...reply, status: "error", error: "The agent stopped before answering. Try again." };
    } catch (e) {
      const stopped = (e as Error).name === "AbortError";
      reply = { ...reply, status: "error", error: stopped ? "Stopped." : (e as Error).message };
    } finally {
      reply = { ...reply, steps: reply.steps.map((s) => (s.status === "run" ? { ...s, status: "error" } : s)) };
      patchTurn(id, reply);
      setBusy(false);
      requestAnimationFrame(() => caseComposer.current?.focus());
    }
  };

  const openBay = (bay: Bay) => {
    setView("chat");
    const existing = cases.find((c) => c.bay === bay.bay);
    if (existing) {
      setActiveId(existing.id);
      setPanelOpen(false);
      return;
    }
    if (bay.patient_id) {
      send(`Brief me on bay ${bay.bay}`, { caseId: null, bay });
      return;
    }
    setActiveId(null);
    setHomeBay(bay);
    requestAnimationFrame(() => homeComposer.current?.focus());
  };

  const crumbTitle = (() => {
    if (!active) return "";
    if (patient && active.unidentified) return `${active.label ?? "Unknown patient"}`;
    return patient?.name ?? active.label ?? active.title;
  })();

  const showPanel = panelOpen && !!patient && view === "chat";
  const sideWidth = phone || !sidebarOpen ? "0px" : narrow ? "240px" : "268px";
  const panelWidth = showPanel && !narrow ? "400px" : "0px";

  return (
    <div
      className="grid h-screen transition-[grid-template-columns] duration-600 ease-[cubic-bezier(.2,.7,.2,1)]"
      style={{ gridTemplateColumns: `${sideWidth} minmax(0,1fr) ${panelWidth}` }}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="flex h-full w-[268px] flex-col max-[1220px]:w-[240px] [&>aside]:h-full">
          <Sidebar
            bays={bays}
            boardError={boardError}
            cases={cases}
            activeCaseId={activeId}
            inbound={view === "inbound"}
            theme={theme}
            onNew={newCase}
            onInbound={() => {
              setView("inbound");
              setPanelOpen(false);
            }}
            onBay={openBay}
            onCase={(id) => {
              setView("chat");
              setActiveId(id);
              setPanelOpen(false);
            }}
            onPrompt={(text) => send(text, { caseId: null })}
            onTheme={toggleTheme}
            onCollapse={() => setSidebarOpen(false)}
          />
        </div>
      </div>

      <main className="relative flex min-h-0 min-w-0 flex-col">
        <div className={clsx("flex min-h-0 flex-1 flex-col", view !== "inbound" && "hidden")}>
          <Inbound active={view === "inbound"} sidebarHidden={!sidebarOpen || phone} onShowSidebar={() => setSidebarOpen(true)} />
        </div>
        <div className={clsx("flex min-h-0 flex-1 flex-col", view !== "chat" && "hidden")}>
        <header className={clsx("flex h-[58px] flex-none items-center gap-4 border-b px-6 transition-colors", active ? "border-line" : "border-transparent")}>
          {(!sidebarOpen || phone) && (
            <button onClick={() => setSidebarOpen(true)} title="Show sidebar" className="rounded-[9px] p-2 text-mute hover:bg-line hover:text-ink">
              <PanelLeft className="size-[18px]" strokeWidth={1.5} />
            </button>
          )}
          {active && (
            <div className="flex min-w-0 items-baseline gap-3">
              {active.bay && <span className="label">Bay {active.bay}</span>}
              <span className="truncate text-[16px] font-normal">
                {crumbTitle}
                <AnimatePresence>
                  {patient && active.unidentified && (
                    <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}>
                      <span className="mx-1.5 text-mute">→</span>
                      {patient.name}
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-1.5 text-mute">
            <span className="inline-flex items-center gap-[7px] rounded-full border border-line px-[11px] py-1.5 font-mono text-[10.5px] leading-none tracking-[.07em] whitespace-nowrap uppercase max-sm:hidden">
              <span className={clsx("size-1.5 rounded-full", boardError ? "bg-mute" : "animate-[pulse-dot_2s_infinite] bg-accent")} />
              Cortex Agent
            </span>
            {patient && (
              <button
                onClick={() => setPanelOpen((o) => !o)}
                title="Patient chart"
                className={clsx("rounded-[9px] p-2 hover:bg-line hover:text-ink", showPanel && "text-ink")}
              >
                <UserRound className="size-[18px]" strokeWidth={1.5} />
              </button>
            )}
          </div>
        </header>

        {active ? (
          <section className="flex min-h-0 flex-1 flex-col">
            <Thread turns={active.turns} busy={busy} onReply={(t) => send(t)} />
            <div className="flex-none bg-[linear-gradient(to_bottom,transparent,var(--paper)_30%)] px-6 pb-[18px]">
              <div className="mx-auto max-w-[760px]">
                <Composer ref={caseComposer} placeholder="Ask a follow-up" onSend={(t) => send(t)} busy={busy} onStop={() => abort.current?.abort()} />
              </div>
            </div>
          </section>
        ) : (
          <Home ref={homeComposer} bay={homeBay?.bay} onSend={(text) => send(text, { caseId: null, bay: homeBay && !/\bbay \d+\b/i.test(text) && !/^who|^how|^chart|^brief/i.test(text) ? homeBay : undefined })} />
        )}
        </div>
      </main>

      <aside
        className={clsx(
          "min-w-0 overflow-hidden border-l border-line bg-raise transition-colors",
          narrow &&
            "fixed top-0 right-0 bottom-0 z-10 w-[min(400px,92vw)] shadow-[-20px_0_40px_-30px_rgba(0,0,0,.4)] transition-transform duration-500",
          narrow && !showPanel && "translate-x-full",
        )}
      >
        <div className="h-full w-[400px] overflow-y-auto max-[1220px]:w-auto">
          <AnimatePresence>
            {patient && showPanel && (
              <PatientPanel chart={patient} identified={!!active?.unidentified} clinician={CLINICIAN} onClose={() => setPanelOpen(false)} />
            )}
          </AnimatePresence>
        </div>
      </aside>
    </div>
  );
}
