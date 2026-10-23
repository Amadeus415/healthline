"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Droplet } from "lucide-react";
import { useState } from "react";
import clsx from "clsx";
import type { Blood } from "@/lib/conversation";

const ease = [0.2, 0.7, 0.2, 1] as const;

export type ReadyItem = {
  id: string;
  task: string;
  why?: string;
  done: boolean;
  blood?: Blood;
  /** Added by the latest change to the list. */
  fresh?: boolean;
  /** Struck by a later order; kept visible so nothing disappears without a trace. */
  removed?: { by: string; reason?: string };
};

/** The nurse's prep list, filled and edited by the doctor's orders. Ticking an item tells the doctor. */
export function ReadyList({ items, onToggle }: { items: ReadyItem[]; onToggle: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  if (!items.length) return null;
  const live = items.filter((i) => !i.removed);
  const done = live.filter((i) => i.done).length;
  // What just changed goes to the top: new items first, then struck ones, then the rest.
  const rank = (i: ReadyItem) => (i.fresh && !i.done ? 0 : i.removed ? 1 : 2);
  const ordered = [...items].sort((a, b) => rank(a) - rank(b));

  return (
    <div className="flex-none border-b border-line px-3 py-2">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between py-0.5">
        <span className="label">Ready list</span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-mute">
          {done}/{live.length} ready
          <ChevronDown className={clsx("size-3 transition-transform", open && "rotate-180")} strokeWidth={1.8} />
        </span>
      </button>
      <div className={clsx("grid max-h-[28vh] grid-cols-1 gap-1 overflow-x-hidden overflow-y-auto py-1 transition-[margin]", open ? "mt-1" : "hidden")}>
        <AnimatePresence initial={false}>
          {ordered.map((item) => (
            <motion.button
              key={item.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: item.removed ? 0.6 : 1 }}
              transition={{ duration: 0.45, ease }}
              onClick={() => onToggle(item.id)}
              disabled={!!item.removed}
              data-ready-item
              data-removed={item.removed ? "" : undefined}
              className={clsx(
                "grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 rounded-[10px] border px-2.5 py-1.5 text-left transition-colors",
                item.removed
                  ? "cursor-default border-dashed border-edge bg-transparent"
                  : item.done
                    ? "border-line bg-transparent"
                    : item.fresh
                      ? "animate-[fresh_2.2s_ease-in-out_infinite] border-danger bg-raise"
                      : "border-accent/40 bg-raise hover:border-accent",
              )}
            >
              <span
                className={clsx(
                  "mt-0.5 grid size-[18px] place-items-center rounded-[6px] border transition-colors",
                  item.done ? "border-accent bg-accent text-white" : "border-edge",
                )}
              >
                {item.done && <Check className="size-3" strokeWidth={2.5} />}
              </span>
              <span className="min-w-0">
                <span className={clsx("block text-[14px] leading-snug font-normal", (item.done || item.removed) && "text-mute line-through")}>
                  {item.blood && !item.removed && (
                    <span className="mr-1.5 inline-flex -translate-y-px items-center gap-0.5 rounded-[5px] bg-danger px-1.5 py-[2px] font-mono text-[11px] font-medium text-white">
                      <Droplet className="size-2.5" strokeWidth={2.5} />
                      {item.blood.abo_rh}
                    </span>
                  )}
                  {item.task}
                </span>
                {item.removed ? (
                  <span className="block text-[12px] leading-snug text-danger">Removed by {item.removed.by}</span>
                ) : (
                  item.why && !item.done && <span className="block truncate text-[12px] leading-snug text-mute" title={item.why}>{item.why}</span>
                )}
                {item.blood?.source && !item.removed && !item.done && (
                  <span className="mt-1 inline-block rounded-[4px] border border-line px-1.5 py-[1px] font-mono text-[10.5px] text-mute">
                    Group from {item.blood.source}
                  </span>
                )}
              </span>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
