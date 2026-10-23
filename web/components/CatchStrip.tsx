"use client";

import { AnimatePresence, motion } from "motion/react";
import { BookOpen, CircleDollarSign, ShieldAlert, Timer } from "lucide-react";
import clsx from "clsx";
import type { Catch } from "@/lib/conversation";

const ease = [0.2, 0.7, 0.2, 1] as const;

export const KINDS = {
  safety: { label: "Safety", Icon: ShieldAlert, tone: "text-accent border-accent/50 bg-accent-soft" },
  time: { label: "Time", Icon: Timer, tone: "text-[#2f7de1] border-[#2f7de1]/40 bg-[#2f7de1]/8" },
  cost: { label: "Cost", Icon: CircleDollarSign, tone: "text-[#1f9d74] border-[#1f9d74]/40 bg-[#1f9d74]/8" },
  research: { label: "Research", Icon: BookOpen, tone: "text-[#8a5cd6] border-[#8a5cd6]/40 bg-[#8a5cd6]/8" },
} as const;

/** What Healthline noticed that a busy team could miss, collected across every reply in the case. */
export function CatchStrip({ catches }: { catches: (Catch & { id: string })[] }) {
  const counts = Object.fromEntries(Object.keys(KINDS).map((k) => [k, catches.filter((c) => c.kind === k).length]));
  const newest = [...catches].reverse();

  return (
    <div className="flex h-[52px] flex-none items-center gap-4 border-b border-line bg-side/60 px-5">
      <div className="flex flex-none items-center gap-3">
        <span className="label">Healthline caught</span>
        <div className="flex gap-1.5">
          {(Object.keys(KINDS) as (keyof typeof KINDS)[]).map((k) => {
            const { Icon, tone, label } = KINDS[k];
            return (
              <span
                key={k}
                title={label}
                className={clsx(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-[3px] font-mono text-[11px] leading-none transition-opacity",
                  tone,
                  !counts[k] && "opacity-35",
                )}
              >
                <Icon className="size-3" strokeWidth={1.8} />
                {counts[k]}
              </span>
            );
          })}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-2 [scrollbar-width:none]">
        {!catches.length && <span className="self-center text-[13px] text-mute">Interactions, duplicate tests, records elsewhere and population signals appear here as the case unfolds.</span>}
        <AnimatePresence initial={false}>
          {newest.map((c, i) => {
            const { Icon, tone } = KINDS[c.kind];
            return (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, y: -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.5, ease }}
                title={c.text}
                className={clsx(
                  "flex max-w-[420px] flex-none items-center gap-2 rounded-[10px] border px-2.5 py-1 text-[13px] leading-snug",
                  tone,
                  i === 0 && "shadow-[0_0_0_3px_var(--accent-soft)]",
                )}
              >
                <Icon className="size-3.5 flex-none" strokeWidth={1.8} />
                <span className="truncate text-ink">{c.text}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
