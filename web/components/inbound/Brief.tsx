"use client";

import { motion } from "motion/react";
import { Check } from "lucide-react";
import { useState } from "react";
import clsx from "clsx";
import { Markdown } from "../Markdown";
import { ease, SourceChip } from "./parts";
import { mmss } from "@/lib/inbound";
import type { Brief } from "@/lib/types";

type Props = {
  brief: Brief;
  /** "06:25", when the identity was confirmed. */
  confirmedAt?: string;
  /** Story seconds until the ambulance arrives; 0 once it has. Undefined outside the workflow. */
  eta?: number;
  compact?: boolean;
};

const show = (i: number) => ({ initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, delay: i, ease } });

/** The pre-arrival brief: one alert strip, three facts with receipts, and what was missed before. */
export function BriefView({ brief, confirmedAt, eta, compact }: Props) {
  const p = brief.patient;
  const here = brief.sites.find((s) => s.here)?.name;
  const alert = brief.alerts.find((a) => a.level === "high");

  const facts = (
    <div className="grid">
      <motion.div {...show(compact ? 0.1 : 1.2)} className="label pb-2">
        {brief.facts.length === 1 ? "1 thing" : `${brief.facts.length} things`} to know now
      </motion.div>
      {brief.facts.map((f, i) => (
        <motion.div
          key={f.topic}
          {...show(compact ? 0.15 + i * 0.08 : 1.5 + i * 0.7)}
          className="grid grid-cols-[30px_1fr] gap-x-3 border-t border-line py-3.5 last:border-b"
        >
          <span className="font-mono text-[13px] text-accent">{String(i + 1).padStart(2, "0")}</span>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
            <div className={clsx(compact ? "[&_p]:text-[15px]" : "[&_p]:text-[17px]", "[&_p]:leading-snug")}>
              <Markdown text={f.text} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {f.sources.map((s) => (
                <SourceChip key={`${s.site}-${s.kind}-${s.date}`} source={s} here={s.site === here} />
              ))}
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );

  const missed = brief.missed.map((m, i) => (
    <motion.div key={m.text} {...show(compact ? 0.4 : 3.8 + i * 0.4)} className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-2xl border border-dashed border-accent px-4 py-3.5">
      <span className="label !text-accent">Missed before</span>
      <div className="[&_p]:text-[15px] [&_p]:leading-snug">
        <Markdown text={m.text} />
      </div>
      <div>
        <SourceChip source={m.source} here={m.source.site === here} />
      </div>
    </motion.div>
  ));

  if (compact) {
    return (
      <div className="grid gap-4">
        {alert && <AlertStrip title={alert.title} detail={alert.detail} small />}
        {facts}
        {missed}
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6">
        <motion.div {...show(0)} className="flex items-center gap-4">
          <div className="grid size-14 flex-none place-items-center rounded-full bg-ink font-mono text-[15px] text-paper">
            {p.first_name[0]}
            {p.last_name[0]}
          </div>
          <div className="min-w-0">
            <div className="text-[34px] leading-none font-light tracking-[-.03em]">
              {p.first_name} <em>{p.last_name}</em>
              <span className="ml-3 text-[18px] text-mute">
                {p.age} · {p.gender}
              </span>
            </div>
            <div className="mt-2 text-[14px] text-mute">
              {confirmedAt && `Identified ${confirmedAt} by triage nurse · `}
              {brief.visits_total} visits from {brief.sites.length} care sites
              {brief.complaint && ` · arriving with ${brief.complaint.toLowerCase()}`}
            </div>
          </div>
        </motion.div>

        {alert && (
          <motion.div {...show(0.6)}>
            <AlertStrip title={alert.title} detail={alert.detail} />
          </motion.div>
        )}
        {facts}
      </div>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
        {missed}
        {brief.actions.length > 0 && <Actions actions={brief.actions} />}
        <motion.div {...show(5.6)} className="grid gap-1 border-t border-line pt-3">
          <span className="label">Allergies</span>
          <span className="text-[15px]">
            {brief.allergies.length
              ? brief.allergies.map((a) => `${a.substance}${a.severity === "SEVERE" ? " (severe)" : ""}`).join(", ")
              : `None on file across ${brief.sites.length} care sites`}
          </span>
        </motion.div>
        <motion.div {...show(6.4)} className="grid gap-1 rounded-2xl bg-ink px-4 py-3.5 text-paper">
          <span className="flex items-center gap-2 text-[15px] font-normal">
            <Check className="size-4" strokeWidth={2} />
            {eta === undefined || eta > 0 ? "Brief ready before arrival" : "Patient arrived · the team was ready"}
          </span>
          {eta !== undefined && eta > 0 && <span className="font-mono text-[11px] tracking-[.04em] opacity-70">Sent to the trauma bay · {mmss(eta)} before arrival</span>}
        </motion.div>
      </div>
    </div>
  );
}

function AlertStrip({ title, detail, small }: { title: string; detail: string; small?: boolean }) {
  return (
    <div className="flex animate-[nudge_2.4s_var(--ease-out-soft)_infinite] items-center gap-4 rounded-2xl bg-accent px-5 py-4 text-white">
      <span className="grid size-10 flex-none place-items-center rounded-xl bg-white/20 text-[20px] font-medium">!</span>
      <div className="grid gap-0.5">
        <b className={clsx("font-normal tracking-[-.01em]", small ? "text-[17px]" : "text-[21px]")}>{title}</b>
        <span className="text-[14px] text-white/80">{detail}</span>
      </div>
    </div>
  );
}

function Actions({ actions }: { actions: string[] }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  return (
    <motion.div {...show(4.8)} className="grid gap-1">
      <span className="label pb-1">Suggested · for clinician review</span>
      {actions.map((a) => {
        const on = done.has(a);
        return (
          <button
            key={a}
            onClick={() => setDone((d) => (d.has(a) ? new Set([...d].filter((x) => x !== a)) : new Set(d).add(a)))}
            className="flex items-center gap-3 border-t border-line py-2.5 text-left text-[15px] last:border-b"
          >
            <span className={clsx("grid size-[18px] flex-none place-items-center rounded-[6px] border transition-colors", on ? "border-ink bg-ink text-paper" : "border-edge")}>
              {on && <Check className="size-3" strokeWidth={2.4} />}
            </span>
            <span className={clsx(on && "text-mute line-through decoration-1")}>{a}</span>
          </button>
        );
      })}
    </motion.div>
  );
}
