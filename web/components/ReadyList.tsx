"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import clsx from "clsx";

const ease = [0.2, 0.7, 0.2, 1] as const;

export type ReadyItem = { id: string; task: string; why?: string; done: boolean };

/** The nurse's prep list, filled by the doctor's requests. Ticking an item tells the doctor. */
export function ReadyList({ items, onToggle }: { items: ReadyItem[]; onToggle: (id: string) => void }) {
  if (!items.length) return null;
  const done = items.filter((i) => i.done).length;

  return (
    <div className="flex-none border-b border-line px-5 py-4">
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="label">Ready list</span>
        <span className="font-mono text-[11px] text-mute">
          {done}/{items.length} ready
        </span>
      </div>
      <div className="grid max-h-[34vh] gap-1.5 overflow-y-auto">
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
                "grid grid-cols-[auto_1fr] items-start gap-3 rounded-[12px] border px-3 py-2.5 text-left transition-colors",
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
                <span className={clsx("block text-[14.5px] leading-snug font-normal", item.done && "text-mute line-through")}>{item.task}</span>
                {item.why && <span className="mt-0.5 block text-[12.5px] leading-snug text-mute">{item.why}</span>}
              </span>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
