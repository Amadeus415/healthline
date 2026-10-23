"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";
import clsx from "clsx";
import type { EventsResult, PatientEvent, Source } from "@/lib/types";

export const ease = [0.2, 0.7, 0.2, 1] as const;

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Where a fact came from: care site, kind of record, date. */
export function SourceChip({ source, here }: { source: Source; here?: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-2.5 py-1 font-mono text-[10.5px] leading-none tracking-[.03em] whitespace-nowrap",
        here ? "border-accent/50 text-accent" : "border-line text-mute",
      )}
    >
      <i className={clsx("size-1.5 flex-none rounded-full", here ? "bg-accent" : "bg-ink/50")} />
      {here ? "This ER" : source.site} · {source.kind}
      {source.date && ` · ${source.date}`}
    </span>
  );
}

/** A number that counts from wherever it was to its new value. */
export function CountUp({ value, from, duration = 1.2, delay = 0, className }: { value: number; from?: number; duration?: number; delay?: number; className?: string }) {
  const mv = useMotionValue(from ?? value);
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString("en-US"));
  useEffect(() => {
    const controls = animate(mv, value, { duration, delay, ease });
    return () => controls.stop();
  }, [mv, value, duration, delay]);
  return <motion.span className={className}>{text}</motion.span>;
}

/** Types text out over `duration` seconds, with a caret while it runs. */
export function Typewriter({ text, duration, className }: { text: string; duration: number; className?: string }) {
  const progress = useMotionValue(0);
  const shown = useTransform(progress, (p) => text.slice(0, Math.round(text.length * p)));
  useEffect(() => {
    const controls = animate(progress, 1, { duration, ease: "linear" });
    return () => controls.stop();
  }, [progress, duration]);
  return (
    <span className={className}>
      <motion.span>{shown}</motion.span>
      <motion.span className="ml-0.5 inline-block h-[.9em] w-[2px] translate-y-[.1em] bg-accent" animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.9 }} />
    </span>
  );
}

const KIND_ORDER = ["imaging", "procedure", "medication", "condition", "lab", "allergy", "visit", "vital", "device"];
const KIND_NAME: Record<string, [string, string]> = {
  imaging: ["imaging study", "imaging studies"],
  procedure: ["procedure", "procedures"],
  medication: ["medication", "medications"],
  condition: ["diagnosis", "diagnoses"],
  lab: ["lab", "labs"],
  allergy: ["allergy", "allergies"],
  visit: ["visit", "visits"],
  vital: ["vital sign", "vital signs"],
  device: ["device", "devices"],
};
export const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The records behind an answer from search_patient_events, as receipts. */
export function EventsView({ data }: { data: EventsResult }) {
  const sorted = [...data.events].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.date.localeCompare(a.date));
  const shown = sorted.slice(0, 6);
  const summary = Object.entries(data.counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => plural(n, ...(KIND_NAME[k] ?? [k, `${k}s`])))
    .join(" · ");
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }} className="grid gap-2.5">
      <div className="label">
        Checked {summary || "0 records"} across {plural(data.care_sites_searched.length, "care site", "care sites")}
      </div>
      {shown.length > 0 && (
        <div className="grid">
          {shown.map((e: PatientEvent, i) => (
            <motion.div
              key={`${e.date}-${e.description}-${i}`}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.05, ease }}
              className="grid grid-cols-[1fr_auto] items-baseline gap-4 border-t border-line py-2 text-[14px] last:border-b"
            >
              <span className="min-w-0 truncate">
                {e.description}
                {e.value && <span className="text-mute"> · {e.value}</span>}
              </span>
              <span className={clsx("font-mono text-[11px] whitespace-nowrap", e.this_er ? "text-accent" : "text-mute")}>
                {e.site ?? "Unknown site"} · {fmtDay(e.date)}
              </span>
            </motion.div>
          ))}
        </div>
      )}
      {data.total > shown.length && <div className="label">{data.total - shown.length} more records</div>}
    </motion.div>
  );
}
