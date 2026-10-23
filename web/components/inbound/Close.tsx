"use client";

import { motion } from "motion/react";
import { ease } from "./parts";
import type { Brief, Stats } from "@/lib/types";

type Props = { stats: Stats | null; searched: number; clues: number; brief: Brief | null; beforeArrival: boolean; onRestart: () => void };

const STACK = ["Data Vault keys", "Gold layer as of 06:21", "Cortex Agent on Claude", "AI_COMPLETE clue reading", "Owner's-rights tools", "Audit logs", "Synthetic Synthea data"];

/** The handoff: what just happened, in four numbers and one closing line. */
export function CloseView({ stats, searched, clues, brief, beforeArrival, onRestart }: Props) {
  const tiles = [
    [`${searched.toLocaleString()} → 1`, "patients to one person"],
    [`${brief?.organization_ids ?? "–"} → ${brief?.sites.length ?? "–"}`, "organization IDs, one record"],
    ["0", "SSNs needed"],
    ["1", "human decision, logged"],
  ];
  return (
    <div className="mx-auto grid max-w-[980px] justify-items-center gap-9 pt-[5vh] text-center">
      <motion.h2 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease }} className="font-serif text-[clamp(40px,5.4vw,68px)] leading-[1.04] tracking-[-.02em]">
        Identified from <em className="text-accent">{clues} clues</em>.
        <br />
        Briefed <em className="text-accent">{beforeArrival ? "before the doors opened" : "as the doors opened"}</em>.
      </motion.h2>

      <div className="grid w-full grid-cols-2 border-t border-line md:grid-cols-4">
        {tiles.map(([n, l], i) => (
          <motion.div
            key={l}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.8 + i * 0.15, ease }}
            className="grid gap-1 border-b border-line px-4 py-5 [&:not(:first-child)]:md:border-l"
          >
            <b className="text-[30px] font-extralight tracking-[-.02em] tabular-nums">{n}</b>
            <span className="text-[13.5px] text-mute">{l}</span>
          </motion.div>
        ))}
      </div>

      {stats && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 1.8 }} className="max-w-[640px] text-[20px] leading-snug">
          Since 2023, <b className="text-accent">{stats.er_visits_on_blood_thinner_since_2023.toLocaleString()}</b> ER visits in this data were by patients already on a
          blood thinner.
        </motion.p>
      )}

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 2.6 }} className="flex flex-wrap justify-center gap-2">
        {STACK.map((s) => (
          <span key={s} className="rounded-full border border-line px-3 py-1.5 font-mono text-[11px] tracking-[.03em] text-mute">
            {s}
          </span>
        ))}
      </motion.div>

      <button onClick={onRestart} className="label underline decoration-1 underline-offset-4 hover:text-ink">
        Run it again
      </button>
    </div>
  );
}
