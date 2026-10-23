"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import clsx from "clsx";

const ease = [0.2, 0.7, 0.2, 1] as const;

export type ReadyItem = { id: string; task: string; why?: string; done: boolean };

/** The nurse's prep list, filled by the doctor's requests. Ticking an item tells the doctor. */
export function ReadyList({ items, onToggle }: { items: ReadyItem[]; onToggle: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  if (!items.length) return null;
  const done = items.filter((i) => i.done).length;

  return (
    <div className="flex-none border-b border-line px-3 py-2">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between py-0.5">
        <span className="label">Ready list</span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-mute">
          {done}/{items.length} ready
          <ChevronDown className={clsx("size-3 transition-transform", open && "rotate-180")} strokeWidth={1.8} />
        </span>
      </button>
      <div className={clsx("grid max-h-[24vh] gap-1 overflow-y-auto transition-[margin]", open ? "mt-1.5" : "hidden")}>
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.button
              key={item.id}
              layout
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45, ease }}
              onClick={() => onToggle(item.id)}
              className={clsx(
                "grid grid-cols-[auto_1fr] items-start gap-2.5 rounded-[10px] border px-2.5 py-1.5 text-left transition-colors",
                item.done ? "border-line bg-transparent" : "border-[#1f9d74]/40 bg-raise hover:border-[#1f9d74]",
              )}
            >
              <span
                className={clsx(
                  "mt-0.5 grid size-[18px] place-items-center rounded-[6px] border transition-colors",
                  item.done ? "border-[#1f9d74] bg-[#1f9d74] text-white" : "border-edge",
                )}
              >
                {item.done && <Check className="size-3" strokeWidth={2.5} />}
              </span>
              <span>
                <span className={clsx("block text-[14px] leading-snug font-normal", item.done && "text-mute line-through")}>{item.task}</span>
                {item.why && !item.done && <span className="block truncate text-[12px] leading-snug text-mute" title={item.why}>{item.why}</span>}
              </span>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
