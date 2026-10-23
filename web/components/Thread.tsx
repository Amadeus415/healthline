"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import clsx from "clsx";
import { Mark } from "./Mark";
import { Markdown } from "./Markdown";
import { Candidates, Funnel, ResultTable, Trace } from "./Blocks";
import { VegaChart } from "./VegaChart";
import { splitOptions, type AssistantTurn, type Turn } from "@/lib/conversation";
import type { Candidate, IdentifyResult } from "@/lib/types";

const ease = [0.2, 0.7, 0.2, 1] as const;

export function Thread({ turns, busy, onReply, dense }: { turns: Turn[]; busy: boolean; onReply: (text: string) => void; dense?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns]);

  // Each identify result is drawn relative to the one before it (continued funnel, struck-out names).
  const previousOf = new Map<string, IdentifyResult | undefined>();
  let last: IdentifyResult | undefined;
  for (const turn of turns) {
    if (turn.role !== "assistant") continue;
    for (const b of turn.blocks) {
      if (b.kind !== "identify") continue;
      previousOf.set(b.id, last);
      last = b.data;
    }
  }
  // Quick replies stay live on the last answer to a person; automatic monitor alarms don't make it stale.
  let lastId: string | undefined;
  turns.forEach((turn, i) => {
    const prev = turns[i - 1];
    const fromMonitor = turn.role === "user" ? turn.auto : prev?.role === "user" && prev.auto;
    if (!fromMonitor) lastId = turn.id;
  });

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      }}
      className={clsx("min-h-0 flex-1 overflow-y-auto", dense ? "px-4 pt-4 pb-3" : "px-6 pt-9 pb-6")}
    >
      <div className={clsx("mx-auto grid w-full max-w-[760px]", dense ? "gap-[22px]" : "gap-[34px]")}>
        <AnimatePresence initial={false}>
          {turns.map((turn) =>
            turn.role === "user" && turn.auto ? (
              <motion.div
                key={turn.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease }}
                className="grid gap-1 rounded-[12px] border border-accent bg-accent-soft px-3.5 py-2.5"
              >
                <span className="label text-accent">Monitor alarm · raised automatically</span>
                <span className="font-mono text-[12.5px] leading-relaxed">{turn.text}</span>
              </motion.div>
            ) : turn.role === "user" ? (
              <motion.div
                key={turn.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease }}
                className="max-w-[78%] justify-self-end rounded-[18px_18px_4px_18px] bg-bubble px-4 py-3 text-[16px] leading-normal"
              >
                {turn.text}
              </motion.div>
            ) : (
              <AssistantMessage
                key={turn.id}
                turn={turn}
                previousOf={previousOf}
                active={turn.id === lastId && !busy}
                onReply={onReply}
              />
            ),
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function AssistantMessage({
  turn,
  previousOf,
  active,
  onReply,
}: {
  turn: AssistantTurn;
  previousOf: Map<string, IdentifyResult | undefined>;
  active: boolean;
  onReply: (text: string) => void;
}) {
  const running = turn.status === "streaming";
  const lastText = [...turn.blocks].reverse().find((b) => b.kind === "text");
  const thinking = running && (!turn.blocks.length || turn.steps.some((s) => s.status === "run")) && !lastText;
  // When the agent draws a chart, the chart replaces the table of the same numbers.
  const charted = turn.blocks.some((b) => b.kind === "chart");

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }} className="grid gap-[18px]">
      <div className="flex items-center gap-2.5">
        <Mark className={clsx("size-5", running && "animate-[pulse-dot_1.6s_ease-in-out_infinite]")} />
      </div>

      <Trace steps={turn.steps} />

      {turn.blocks.map((b) => {
        if (b.kind === "identify") return <IdentifyView key={b.id} data={b.data} previous={previousOf.get(b.id)} />;
        if (b.kind === "table") return charted ? null : <ResultTable key={b.id} columns={b.columns} rows={b.rows} title={b.title} />;
        if (b.kind === "chart") return <VegaChart key={b.id} spec={b.spec} />;
        const streamingThis = running && b === lastText;
        const { body, options } = splitOptions(b.text);
        if (!options.length) return body.trim() ? <Markdown key={b.index} text={body.trim()} streaming={streamingThis} /> : null;
        const paragraphs = body.trim().split(/\n\s*\n/);
        const question = paragraphs.pop() ?? "";
        return (
          <div key={b.index} className="grid gap-[18px]">
            {paragraphs.length > 0 && <Markdown text={paragraphs.join("\n\n")} />}
            <AskCard question={question} options={options} active={active} onReply={onReply} />
          </div>
        );
      })}

      {thinking && (
        <div className="flex items-center gap-3 text-mute">
          <span className="inline-flex gap-1 py-2">
            {[0, 0.15, 0.3].map((d) => (
              <i key={d} className="size-[5px] animate-[blink_1.2s_infinite] rounded-full bg-mute" style={{ animationDelay: `${d}s` }} />
            ))}
          </span>
          {turn.statusText && <span className="font-mono text-[12px] tracking-[.02em]">{turn.statusText}</span>}
        </div>
      )}

      {turn.status === "error" && (
        <div className="rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 text-[14px] text-accent">{turn.error}</div>
      )}
    </motion.div>
  );
}

function IdentifyView({ data, previous }: { data: IdentifyResult; previous?: IdentifyResult }) {
  const max = data.funnel[0]?.count ?? 1;
  const continues =
    previous && previous.funnel.length < data.funnel.length && previous.funnel.every((s, i) => s.label === data.funnel[i]?.label);
  const steps = continues ? data.funnel.slice(previous!.funnel.length) : data.funnel;

  const leader = data.leader ? data.candidates.filter((c) => c.patient_id === data.leader!.patient_id) : [];
  const shown: Candidate[] = leader.length ? leader : data.candidates.slice(0, 3);
  const ids = new Set(shown.map((c) => c.patient_id));
  const ruledOut = continues ? previous!.candidates.slice(0, 3).filter((c) => !ids.has(c.patient_id)) : [];

  return (
    <div className="grid gap-[18px]">
      <Funnel steps={steps} max={max} offset={continues ? previous!.funnel.length : 0} />
      {data.candidates.length > 0 ? (
        <Candidates candidates={shown} ruledOut={ruledOut} />
      ) : (
        <p className="text-[15px] text-mute">Nobody matches all of that. Loosen a clue and try again.</p>
      )}
    </div>
  );
}

function AskCard({
  question,
  options,
  active,
  onReply,
}: {
  question: string;
  options: string[];
  active: boolean;
  onReply: (text: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2, ease }}
      className="grid gap-3 rounded-[14px] border border-accent bg-accent-soft px-[18px] py-4"
    >
      <div className="[&_p]:text-[16px]">
        <Markdown text={question} />
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((o, i) => (
          <button
            key={o}
            disabled={!active}
            onClick={() => onReply(o)}
            className={clsx(
              "rounded-full border px-3.5 py-2 text-[14px] font-normal transition-colors disabled:cursor-default disabled:opacity-50",
              i === 0
                ? "border-accent text-accent enabled:hover:bg-accent enabled:hover:text-white"
                : "border-edge enabled:hover:border-ink",
              i === 0 && active && "animate-[nudge_2.4s_var(--ease-out-soft)_infinite]",
            )}
          >
            {o}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
