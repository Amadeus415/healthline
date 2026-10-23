"use client";

import { motion } from "motion/react";
import clsx from "clsx";
import type { Candidate, FunnelStep } from "@/lib/types";
import type { Step } from "@/lib/conversation";

const ease = [0.2, 0.7, 0.2, 1] as const;

/** Tool calls as a quiet checklist, like the mockup's trace. */
export function Trace({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  return (
    <div className="grid gap-[7px] border-l border-line pl-4">
      {steps.map((s) => (
        <motion.div
          key={s.id}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, ease }}
          className="flex items-center gap-2.5 font-mono text-[12px] leading-tight tracking-[.02em] text-mute"
        >
          <i
            className={clsx(
              "relative size-3 flex-none rounded-full border",
              s.status === "run" && "animate-[spin_.8s_linear_infinite] border-accent border-r-transparent",
              s.status === "done" && "border-ink bg-ink",
              s.status === "error" && "border-accent bg-accent",
            )}
          >
            {s.status === "done" && (
              <span className="absolute top-[1.5px] left-[3.5px] h-[6px] w-[3px] rotate-45 border-r border-b border-paper" />
            )}
          </i>
          <span className={clsx(s.status === "run" && "text-ink")}>{s.label}</span>
          {s.ms !== undefined && <span className="ml-auto tabular-nums">{(s.ms / 1000).toFixed(1)}s</span>}
        </motion.div>
      ))}
    </div>
  );
}

/** Lollipop funnel on a log scale, so 361,607 and 3 both read. */
export function Funnel({ steps, max, offset = 0 }: { steps: FunnelStep[]; max: number; offset?: number }) {
  const scale = (n: number) => (n <= 1 || max <= 1 ? 0.02 : Math.log(n) / Math.log(max));
  return (
    <div className="grid">
      {steps.map((s, i) => {
        const hot = i === steps.length - 1;
        return (
          <motion.div
            key={`${offset + i}-${s.label}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: i * 0.08, ease }}
            className={clsx(
              "grid grid-cols-[minmax(120px,230px)_1fr_74px] items-center gap-5 border-t border-line py-2.5 text-[14.5px] max-sm:grid-cols-[110px_1fr_60px] max-sm:gap-3 max-sm:text-[13px]",
              hot && "border-b",
            )}
          >
            <span className={clsx(hot && "text-accent")}>{s.label}</span>
            <span className="relative h-px">
              <motion.span
                className={clsx("absolute top-0 left-0 h-px", hot ? "bg-accent" : "bg-ink")}
                initial={{ width: 0 }}
                animate={{ width: `${scale(s.count) * 100}%` }}
                transition={{ duration: 1.2, delay: i * 0.08, ease }}
              />
              <motion.span
                className={clsx("absolute -top-1 -ml-1 size-[9px] rounded-full", hot ? "bg-accent" : "bg-ink")}
                initial={{ left: 0 }}
                animate={{ left: `${scale(s.count) * 100}%` }}
                transition={{ duration: 1.2, delay: i * 0.08, ease }}
              />
            </span>
            <span className={clsx("text-right font-mono text-[13px] tabular-nums", hot && "text-accent")}>{s.count.toLocaleString()}</span>
          </motion.div>
        );
      })}
    </div>
  );
}

function why(c: Candidate) {
  const parts = [c.height_cm ? `${c.height_cm} cm` : null];
  if (c.identifying_marks[0]) parts.push(c.identifying_marks[0].replace(/ \(.*\)$/, "").toLowerCase());
  else if (c.notable_medications[0]) parts.push(c.notable_medications[0].split(" ")[0].toLowerCase());
  return parts.filter(Boolean).join(" · ");
}

/** Ranked candidates. On a re-rank, the ones that dropped out stay visible, struck through. */
export function Candidates({ candidates, ruledOut = [] }: { candidates: Candidate[]; ruledOut?: Candidate[] }) {
  const shown = candidates.slice(0, 3);
  const rows = [...shown.map((c) => ({ c, out: false })), ...ruledOut.map((c) => ({ c, out: true }))];
  return (
    <div className="grid">
      {rows.map(({ c, out }, i) => {
        const top = i === 0 && !out;
        const p = out ? 0 : c.probability;
        return (
          <motion.div
            key={c.patient_id}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: out ? 0.35 : 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 + i * 0.08, ease }}
            className={clsx("grid grid-cols-[1fr_120px] gap-x-6 gap-y-1.5 border-t border-line py-3.5", i === rows.length - 1 && "border-b")}
          >
            <div className={clsx("text-[17px] font-normal", out && "line-through decoration-1")}>
              {c.name}
              <span className="ml-2 text-[14px] font-light text-mute">{c.age}</span>
            </div>
            <div className="row-span-2 grid content-center gap-1.5">
              <b className={clsx("text-right font-mono text-[13px] font-normal", top && "text-accent")}>{p.toFixed(2)}</b>
              <span className="relative h-px bg-line">
                <motion.i
                  className={clsx("absolute top-0 left-0 h-px", top ? "bg-accent" : "bg-ink")}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(p * 100, 1)}%` }}
                  transition={{ duration: 1, delay: 0.4 + i * 0.08, ease }}
                />
              </span>
            </div>
            <div className="text-[13.5px] text-mute">{why(c)}</div>
          </motion.div>
        );
      })}
    </div>
  );
}

export function ResultTable({ columns, rows, title }: { columns: string[]; rows: (string | null)[][]; title?: string }) {
  const visible = rows.slice(0, 12);
  return (
    <div className="grid gap-2">
      {title && <div className="label">{title}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} className="label border-b border-line py-2 pr-5 font-normal whitespace-nowrap">
                  {c.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <motion.tr key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}>
                {r.map((v, j) => (
                  <td key={j} className="border-b border-line py-2 pr-5 whitespace-nowrap tabular-nums">
                    {format(v, columns[j])}
                  </td>
                ))}
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > visible.length && <div className="label">{rows.length - visible.length} more rows</div>}
    </div>
  );
}

function format(v: string | null, column: string) {
  if (v === null) return <span className="text-mute">–</span>;
  // Snowflake returns timestamps as epoch seconds or "YYYY-MM-DD hh:mm:ss.fff".
  if (/^\d{9,10}\.\d+$/.test(v)) return new Date(Number(v) * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const date = v.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?)?$/);
  if (date) {
    const d = new Date(`${date[1]}T00:00:00Z`);
    if (/MONTH/i.test(column)) return d.toLocaleDateString([], { month: "short", year: "numeric", timeZone: "UTC" });
    if (!date[2] || date[2] === "00:00:00") return d.toLocaleDateString([], { dateStyle: "medium", timeZone: "UTC" });
    return new Date(`${date[1]}T${date[2]}`).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }
  if (/DATE|MONTH|DAY|WEEK|YEAR/i.test(column) && /^\d{4,5}$/.test(v)) return new Date(Number(v) * 86400000).toLocaleDateString([], { dateStyle: "medium", timeZone: "UTC" });
  if (/^-?\d+(\.\d+)?$/.test(v) && v.length > 3 && !/ID$/i.test(column)) return Number(v).toLocaleString();
  return v;
}
