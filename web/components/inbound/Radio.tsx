"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Play } from "lucide-react";
import clsx from "clsx";
import { ease, Typewriter } from "./parts";
import { RADIO, type Clue } from "@/lib/inbound";

type Props = {
  started: boolean;
  heard: Clue[];
  complaint: string;
  parsing: boolean;
  onPlay: () => void;
  onNext: () => void;
};

/** Medic 14 calls in: no name, no ID, no history. Claude reads the call into clues. */
export function RadioView({ started, heard, complaint, parsing, onPlay, onNext }: Props) {
  return (
    <div className="mx-auto grid w-full max-w-[880px] gap-8 pt-[6vh]">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease }}
        className="grid gap-7 rounded-[26px] border border-line bg-raise px-9 py-8 shadow-[0_30px_60px_-36px_rgba(0,0,0,.3)]"
      >
        <div className="flex items-center gap-2.5 font-mono text-[11.5px] tracking-[.07em] text-accent uppercase">
          <span className="size-2 animate-[pulse-dot_1.4s_infinite] rounded-full bg-accent" />
          Medic 14 → Westpark ER · radio
        </div>
        <div className="min-h-[150px] text-[clamp(28px,3.6vw,42px)] leading-[1.22] font-light tracking-[-.025em]">
          {started ? <Typewriter text={RADIO} duration={3.6} /> : <span className="text-mute">Waiting for the call…</span>}
        </div>
        <div className="flex flex-wrap gap-2.5">
          {["No name", "No ID", "History: unknown"].map((u, i) => (
            <motion.span
              key={u}
              initial={{ opacity: 0, y: 6 }}
              animate={started ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
              transition={{ duration: 0.5, delay: 4 + i * 0.35, ease }}
              className="rounded-full border border-accent px-3.5 py-1.5 text-[14px] text-accent"
            >
              {u}
            </motion.span>
          ))}
        </div>
      </motion.div>

      <AnimatePresence mode="wait">
        {!started ? (
          <motion.button
            key="play"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onPlay}
            className="inline-flex items-center gap-2.5 justify-self-center rounded-full bg-accent px-5 py-3 text-[16px] text-white shadow-[0_10px_24px_-10px_var(--accent)]"
          >
            <Play className="size-4 fill-current" /> Take the radio call
          </motion.button>
        ) : (
          (parsing || heard.length > 0) && (
            <motion.div key="heard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }} className="grid gap-3">
              <span className="label">{parsing ? "Claude is reading the call…" : "Claude heard · PARSE_CLUES on AI_COMPLETE"}</span>
              <div className="flex flex-wrap items-center gap-2">
                {heard.map((c, i) => (
                  <motion.span
                    key={c.id}
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.12, ease }}
                    className="inline-flex items-center gap-2 rounded-full border border-edge px-3.5 py-2 text-[15px]"
                  >
                    <span className="font-mono text-[10.5px] tracking-[.05em] text-mute uppercase">{c.label}</span>
                    {c.value}
                  </motion.span>
                ))}
                {complaint && (
                  <span className="inline-flex items-center gap-2 rounded-full border border-edge px-3.5 py-2 text-[15px]">
                    <span className="font-mono text-[10.5px] tracking-[.05em] text-mute uppercase">Complaint</span>
                    {complaint}
                  </span>
                )}
                {!parsing && (
                  <button onClick={onNext} className={clsx("ml-auto inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[15px] text-paper")}>
                    Start the search <ArrowRight className="size-4" strokeWidth={1.8} />
                  </button>
                )}
              </div>
            </motion.div>
          )
        )}
      </AnimatePresence>
    </div>
  );
}
