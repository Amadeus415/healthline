"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, BellRing, ChevronDown, UserRound } from "lucide-react";
import { useRef, useState } from "react";
import clsx from "clsx";
import { Composer, type ComposerHandle } from "./Composer";
import { Mark } from "./Mark";
import { Thread } from "./Thread";
import type { Turn } from "@/lib/conversation";
import type { Persona } from "@/lib/personas";

const ease = [0.2, 0.7, 0.2, 1] as const;

export type InboxItem = {
  id: string;
  from: string;
  priority: "critical" | "high" | "routine";
  title: string;
  summary?: string;
  at: number;
};

type Props = {
  persona: Persona;
  turns: Turn[];
  busy: boolean;
  running: boolean;
  queued: number;
  inbox: InboxItem[];
  fresh: boolean;
  empty: { title: string; hint: string; prompt?: string };
  onAck: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onChart?: () => void;
  children?: React.ReactNode;
};

const ago = (at: number) => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 60 ? "now" : `${Math.round(s / 60)} min`;
};

/** One person's view of the shared case: their alerts, their conversation with Healthline, their composer. */
export function PersonaColumn({ persona, turns, busy, running, queued, inbox, fresh, empty, onAck, onSend, onStop, onChart, children }: Props) {
  const composer = useRef<ComposerHandle>(null);
  const [showAll, setShowAll] = useState(false);
  // Only the newest alert takes room; older ones fold away so the conversation keeps the height.
  const newestFirst = [...inbox].reverse();
  const visible = showAll ? newestFirst : newestFirst.slice(0, 1);

  return (
    <section
      onPointerDown={onAck}
      onFocusCapture={onAck}
      style={{ "--tint": persona.tint } as React.CSSProperties}
      className={clsx(
        "relative flex min-h-0 min-w-0 flex-col border-r border-line transition-shadow duration-500 last:border-r-0",
        fresh && "shadow-[inset_0_0_0_2px_var(--tint)]",
      )}
    >
      {fresh && <div aria-hidden className="pointer-events-none absolute inset-0 z-10 animate-[ring_1.6s_ease-out_infinite] shadow-[inset_0_0_0_2px_var(--tint)]" />}

      <header className="flex h-[52px] flex-none items-center gap-3 border-b border-line px-4">
        <div className="grid size-[30px] flex-none place-items-center rounded-full border font-mono text-[11px] tracking-[.04em]" style={{ borderColor: persona.tint, color: persona.tint }}>
          {persona.initials}
        </div>
        <div className="min-w-0 leading-tight">
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-normal">{persona.name}</span>
            <span className="label" style={{ color: persona.tint }}>
              {persona.role}
            </span>
          </div>
          <div className="truncate text-[12.5px] text-mute">{persona.where}</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {queued > 0 && <span className="label rounded-full border border-line px-2 py-1">Queued</span>}
          {running && <span className="size-1.5 animate-[pulse-dot_1s_infinite] rounded-full" style={{ background: persona.tint }} />}
          {onChart && (
            <button onClick={onChart} title="Patient chart" className="rounded-[9px] p-2 text-mute hover:bg-line hover:text-ink">
              <UserRound className="size-[18px]" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </header>

      <AnimatePresence initial={false}>
        {inbox.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-none border-b border-line">
            <div className={clsx("grid gap-1.5 overflow-y-auto px-3 pt-2.5", inbox.length > 1 ? "pb-1" : "pb-2.5", showAll && "max-h-[30vh]")}>
              {visible.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: -10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.5, ease }}
                  className={clsx(
                    "grid gap-0.5 rounded-[12px] border px-3 py-2",
                    item.priority === "critical" ? "border-accent bg-accent-soft" : "border-line bg-raise",
                    i > 0 && "opacity-70",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <BellRing className={clsx("size-3.5 flex-none", item.priority === "critical" ? "text-accent" : "text-mute")} strokeWidth={1.8} />
                    <span className="label" style={{ color: item.priority === "critical" ? "var(--accent)" : undefined }}>
                      {item.priority} · from {item.from}
                    </span>
                    <span className="ml-auto font-mono text-[10.5px] text-mute">{ago(item.at)}</span>
                  </div>
                  <div className="text-[14.5px] leading-snug font-normal">{item.title}</div>
                  {item.summary && (
                    <div className={clsx("text-[13px] leading-snug text-mute", !showAll && "line-clamp-2")} title={item.summary}>
                      {item.summary}
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
            {inbox.length > 1 && (
              <button onClick={() => setShowAll((s) => !s)} className="label flex w-full items-center justify-center gap-1 pb-1.5 hover:text-ink">
                {showAll ? "Show latest only" : `${inbox.length - 1} earlier alert${inbox.length > 2 ? "s" : ""}`}
                <ChevronDown className={clsx("size-3 transition-transform", showAll && "rotate-180")} strokeWidth={1.8} />
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {children}

      {turns.length ? (
        <Thread dense turns={turns} busy={busy} onReply={onSend} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <Mark className={clsx("size-8", !empty.prompt && "animate-[pulse-dot_2.4s_ease-in-out_infinite]")} />
          <div className="font-serif text-[26px] leading-tight tracking-[-.01em]">{empty.title}</div>
          <p className="max-w-[320px] text-[14px] text-mute">{empty.hint}</p>
          {empty.prompt && (
            <button
              onClick={() => onSend(empty.prompt!)}
              className="group mt-2 grid max-w-[380px] grid-cols-[1fr_auto] items-center gap-4 rounded-[14px] border border-line bg-raise px-4 py-3 text-left text-[14px] leading-snug transition-colors hover:border-edge"
            >
              <span>{empty.prompt}</span>
              <ArrowRight className="size-4 text-mute transition-transform group-hover:translate-x-0.5" style={{ color: persona.tint }} strokeWidth={1.6} />
            </button>
          )}
        </div>
      )}

      <div className="flex-none px-3 pb-3">
        <Composer compact ref={composer} placeholder={persona.placeholder} onSend={onSend} busy={running} onStop={onStop} />
      </div>
    </section>
  );
}
