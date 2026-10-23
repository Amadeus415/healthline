"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ArrowUp, Mic, Plus } from "lucide-react";
import { useState } from "react";
import clsx from "clsx";
import { Funnel } from "../Blocks";
import { CountUp, ease } from "./parts";
import { VISIBLE, VOLUNTEERED, type Clue } from "@/lib/inbound";
import type { IdentifyResult, NextQuestion } from "@/lib/types";

type Props = {
  clues: Clue[];
  result: IdentifyResult | null;
  loading: boolean;
  parsing: boolean;
  error?: string;
  metro: string;
  /** Clue kinds the paramedic has already reported. */
  used: Set<NextQuestion["clue"]>;
  onAnswer: (clue: NextQuestion["clue"]) => void;
  onTyped: (text: string) => void;
  onNext: () => void;
};

export function CluesView({ clues, result, loading, parsing, error, metro, used, onAnswer, onTyped, onNext }: Props) {
  const total = result?.total_matches ?? 0;
  const volunteer = VOLUNTEERED.filter((c) => !used.has(c));
  const questions = result?.next_questions ?? [];
  const best = questions.find((q) => VISIBLE[q.clue] && !used.has(q.clue));
  const found = !!result?.leader || (result !== null && total > 0 && total <= 5);

  return (
    <div className="grid gap-10 lg:grid-cols-[330px_minmax(0,1fr)]">
      <Phone clues={clues} volunteer={volunteer} parsing={parsing} busy={loading} onAnswer={onAnswer} onTyped={onTyped} />

      <div className="grid content-start gap-7">
        <div>
          <div className="label">Possible matches in {metro}</div>
          <div className="flex items-baseline gap-4">
            <CountUp
              value={total}
              className={clsx(
                "text-[clamp(72px,9vw,124px)] leading-none font-extralight tracking-[-.05em] tabular-nums transition-colors duration-700",
                found ? "text-accent" : "text-ink",
              )}
            />
            <span className="text-[17px] text-mute">{total === 1 ? "patient" : "patients"}</span>
            {loading && <span className="size-2 animate-[pulse-dot_1s_infinite] rounded-full bg-accent" />}
          </div>
        </div>

        {result && <Funnel steps={result.funnel} max={result.funnel[0]?.count ?? 1} />}
        {error && <div className="rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 text-[14px] text-accent">{error}</div>}

        <AnimatePresence mode="wait">
          {found ? (
            <motion.div
              key="found"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease }}
              className="flex flex-wrap items-center justify-between gap-4 rounded-[14px] border border-accent bg-accent-soft px-[18px] py-4"
            >
              <div>
                <span className="label !text-accent">Short list</span>
                <p className="text-[18px]">
                  {total} {total === 1 ? "person matches" : "people match"} every clue. Time for the triage nurse.
                </p>
              </div>
              <button onClick={onNext} className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-[15px] text-white">
                Review candidates <ArrowRight className="size-4" strokeWidth={1.8} />
              </button>
            </motion.div>
          ) : questions.length > 0 ? (
            <motion.div
              key={questions.map((q) => q.clue).join()}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease }}
              className={clsx("grid gap-3 rounded-[14px] border border-accent bg-accent-soft px-[18px] py-4 transition-opacity", loading && "opacity-60")}
            >
              <span className="label !text-accent">Best next question · computed from {total.toLocaleString()} records</span>
              <div className="grid">
                {questions.map((q, i) => {
                  const answer = VISIBLE[q.clue];
                  const top = q === best;
                  return (
                    <div key={q.clue} className={clsx("grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-2.5", i > 0 && "border-t border-accent/20")}>
                      <span className={clsx(top ? "text-[18px]" : "text-[15px] text-ink/70")}>{q.question}</span>
                      <span className="text-right font-mono text-[11px] tracking-[.04em] text-mute">≈ {Math.max(1, Math.round(q.expected_left)).toLocaleString()} left</span>
                      {top && <span className="col-span-2 text-[13px] text-mute">{q.why}</span>}
                      <span className="col-span-2">
                        {used.has(q.clue) ? (
                          <span className="font-mono text-[11px] text-mute">Answered · updating the count…</span>
                        ) : answer ? (
                          <button
                            disabled={loading}
                            onClick={() => onAnswer(q.clue)}
                            className={clsx(
                              "mt-1 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13.5px] transition-colors disabled:opacity-50",
                              top ? "animate-[nudge_2.4s_var(--ease-out-soft)_infinite] border-accent text-accent hover:bg-accent hover:text-white" : "border-edge hover:border-ink",
                            )}
                          >
                            Paramedic sees: {answer.label.toLowerCase()} · {answer.value}
                          </button>
                        ) : (
                          <span className="font-mono text-[11px] text-mute">Paramedic: nothing like that on her</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          ) : (
            result &&
            total > 5000 && (
              <motion.p key="wide" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[15px] text-mute">
                Still too many to rank. Where she was found and how tall she is will narrow it fast.
              </motion.p>
            )
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Phone({
  clues,
  volunteer,
  parsing,
  busy,
  onAnswer,
  onTyped,
}: {
  clues: Clue[];
  volunteer: NextQuestion["clue"][];
  parsing: boolean;
  busy: boolean;
  onAnswer: (clue: NextQuestion["clue"]) => void;
  onTyped: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease }}
      className="relative h-fit rounded-[44px] border border-edge bg-side p-3 shadow-[0_30px_60px_-30px_rgba(0,0,0,.35)] max-lg:mx-auto max-lg:w-full max-lg:max-w-[360px]"
    >
      <div className="absolute top-[22px] left-1/2 h-6 w-24 -translate-x-1/2 rounded-full bg-ink" />
      <div className="flex min-h-[560px] flex-col gap-2.5 rounded-[34px] bg-raise px-4 pt-14 pb-4">
        <div>
          <div className="text-[20px] font-normal">Unknown patient</div>
          <div className="label">Medic 14 · what I can see</div>
        </div>
        <div className="grid gap-2 pt-1">
          <AnimatePresence initial={false}>
            {clues.map((c) => (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.45, ease }}
                className={clsx(
                  "flex items-center justify-between gap-3 rounded-[14px] border px-3.5 py-2.5",
                  c.from === "radio" ? "border-line bg-paper" : "border-accent/40 bg-accent-soft",
                )}
              >
                <span className="font-mono text-[10.5px] tracking-[.05em] text-mute uppercase">{c.label}</span>
                <b className="text-right text-[14.5px] font-normal">{c.value}</b>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        {volunteer.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {volunteer.map((v) => (
              <button
                key={v}
                disabled={busy}
                onClick={() => onAnswer(v)}
                className="inline-flex items-center gap-1 rounded-full border border-edge px-2.5 py-1.5 text-[12.5px] transition-colors hover:border-ink disabled:opacity-50"
              >
                <Plus className="size-3" strokeWidth={2} />
                {VISIBLE[v]!.label}: {VISIBLE[v]!.value}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim() || parsing) return;
            onTyped(text.trim());
            setText("");
          }}
          className="flex items-center gap-2 rounded-full border border-line bg-paper py-1.5 pr-1.5 pl-3"
        >
          <Mic className="size-4 flex-none text-mute" strokeWidth={1.5} />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={parsing ? "Claude is reading that…" : "Say or type a clue"}
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-mute"
          />
          <button disabled={!text.trim() || parsing} className="grid size-8 place-items-center rounded-full bg-accent text-white disabled:opacity-35">
            <ArrowUp className="size-4" strokeWidth={1.8} />
          </button>
        </form>
      </div>
    </motion.div>
  );
}
