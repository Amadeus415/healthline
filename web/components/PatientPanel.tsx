"use client";

import { AnimatePresence, motion } from "motion/react";
import { Lock, X } from "lucide-react";
import { useState } from "react";
import clsx from "clsx";
import type { Chart } from "@/lib/types";

const ease = [0.2, 0.7, 0.2, 1] as const;

const fmtDate = (d: string | null) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–";

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bLlc\b|\bInc\b\.?/g, (m) => m.toUpperCase());

type Props = { chart: Chart; identified: boolean; clinician: string; onClose: () => void };

/** The patient chart, as an artifact panel beside the thread. */
export function PatientPanel({ chart, identified, clinician, onClose }: Props) {
  const v = chart.vitals;
  const maxVisits = Math.max(...chart.care_sites.map((s) => s.visits), 1);

  return (
    <motion.div
      key={chart.patient_id}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.7, delay: 0.15, ease }}
      className="grid content-start gap-[26px] px-[26px] pt-[22px] pb-7"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[11px] tracking-[.07em] text-accent uppercase">
          <span className="size-1.5 rounded-full bg-accent" />
          {identified ? "Likely match · confirm ID" : "Patient chart"}
        </div>
        <button onClick={onClose} title="Close" className="rounded-[9px] p-2 text-mute hover:bg-line hover:text-ink">
          <X className="size-[18px]" strokeWidth={1.5} />
        </button>
      </div>

      <div>
        <div className="text-[40px] leading-none font-light tracking-[-.03em]">
          {chart.first_name} <em>{chart.last_name}</em>
        </div>
        <div className="mt-2.5 text-[14px] text-mute">
          {chart.age} · {chart.gender === "M" ? "Male" : "Female"} · {chart.city}, {chart.state}
        </div>
      </div>

      {chart.alerts.length > 0 && (
        <div className="grid">
          {chart.alerts.map((a, i) => (
            <motion.div
              key={a.title}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.08, ease }}
              className={clsx(
                "grid gap-1 py-3",
                a.level === "high" ? "border-y border-accent" : "border-b border-line",
                i > 0 && a.level === "high" && "border-t-0",
              )}
            >
              <span className={clsx("label", a.level === "high" && "!text-accent")}>{a.title}</span>
              <b className={clsx("font-normal", a.level === "high" ? "text-[18px]" : "text-[14.5px]")}>{a.detail}</b>
            </motion.div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 border-t border-line">
        {[
          ["Height", v.height_cm, "cm"],
          ["Weight", v.weight_kg, "kg"],
          ["HR", v.heart_rate, ""],
          ["BP", v.bp, ""],
          ["BMI", v.bmi, ""],
          ["ER visits", chart.visits.er, ""],
        ].map(([label, value, unit], i) => (
          <div key={label as string} className={clsx("grid gap-1 border-b border-line py-3", i % 3 !== 0 && "border-l pl-3.5")}>
            <span className="label">{label}</span>
            <b className="text-[24px] font-extralight tracking-[-.02em]">
              {value === null || value === undefined ? "–" : typeof value === "number" ? Math.round(value * 10) / 10 : value}
              {unit && <small className="ml-0.5 text-[12px] font-light tracking-normal text-mute">{unit}</small>}
            </b>
          </div>
        ))}
      </div>

      <Section title="Medications" aside={String(chart.medications.length)}>
        {chart.medications.length ? (
          chart.medications.map((m) => (
            <Row key={m.full} title={m.full}>
              <span className={clsx(m.flag && "text-accent")}>{m.name}</span>
            </Row>
          ))
        ) : (
          <Row>
            <span className="text-mute">None active</span>
          </Row>
        )}
      </Section>

      <Section title="Conditions" aside={String(chart.conditions.length)}>
        {chart.conditions.slice(0, 8).map((c) => (
          <Row key={c}>{c}</Row>
        ))}
      </Section>

      <Section title="Allergies" aside={chart.allergies.length ? String(chart.allergies.length) : "None"}>
        {chart.allergies.map((a) => (
          <Row key={a.substance} aside={a.severity?.toLowerCase()}>
            <span className={clsx(a.severity === "SEVERE" && "text-accent")}>
              {a.substance}
              {a.reaction && <span className="text-mute"> · {a.reaction.toLowerCase()}</span>}
            </span>
          </Row>
        ))}
      </Section>

      {chart.identifying_marks.length > 0 && (
        <Section title="Identifying marks">
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {chart.identifying_marks.map((m) => (
              <span key={m} className="rounded-full border border-edge px-3 py-1 text-[13px]">
                {m}
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section title={`Unified from ${chart.care_sites.length} care sites`} aside={`${chart.visits.total} visits`}>
        {chart.care_sites.map((s, i) => (
          <div key={s.name} className="grid grid-cols-[1fr_64px] gap-x-3.5 gap-y-1.5 border-t border-line py-2.5 text-[13.5px] last:border-b">
            <span>{titleCase(s.name)}</span>
            <span className="text-right font-mono text-[12px] text-mute">{s.visits}</span>
            <span className="relative col-span-2 mr-1 h-px">
              <motion.span
                className="absolute top-0 left-0 h-px bg-ink"
                initial={{ width: 0 }}
                animate={{ width: `${(s.visits / maxVisits) * 100}%` }}
                transition={{ duration: 1, delay: 0.4 + i * 0.08, ease }}
              />
              <motion.span
                className="absolute -top-[3px] -ml-[3px] size-[7px] rounded-full bg-ink"
                initial={{ left: 0 }}
                animate={{ left: `${(s.visits / maxVisits) * 100}%` }}
                transition={{ duration: 1, delay: 0.4 + i * 0.08, ease }}
              />
            </span>
          </div>
        ))}
        <div className="pt-2 text-[12.5px] text-mute">Last seen {fmtDate(chart.visits.last_visit)}</div>
      </Section>

      {chart.sensitive_record_count > 0 && <BreakGlass chart={chart} clinician={clinician} />}

      <div className="grid gap-1 pt-1.5 font-mono text-[10px] leading-normal tracking-[.06em] text-mute uppercase">
        <span>Data Vault key {chart.patient_hk.slice(0, 16).toLowerCase()}…</span>
        <span>Synthetic data · Synthea · as of 1 Nov 2024</span>
      </div>
    </motion.div>
  );
}

function BreakGlass({ chart, clinician }: { chart: Chart; clinician: string }) {
  const [stage, setStage] = useState<"closed" | "reason" | "loading" | "open" | "error">("closed");
  const [reason, setReason] = useState("");
  const [records, setRecords] = useState<{ description: string; kind: string }[]>([]);
  const [error, setError] = useState("");

  const open = async () => {
    setStage("loading");
    try {
      const res = await fetch("/api/break-glass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: chart.patient_id, reason, clinician }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setRecords(json.records);
      setStage("open");
    } catch (e) {
      setError((e as Error).message);
      setStage("error");
    }
  };

  return (
    <div className={clsx("grid gap-2.5 rounded-xl border px-4 py-3.5", stage === "open" ? "border-accent" : "border-dashed border-edge")}>
      <AnimatePresence mode="wait">
        {stage === "open" ? (
          <motion.div key="open" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid gap-2">
            <span className="label !text-accent">Opened · logged to ACCESS_LOG</span>
            <div className="grid">
              {records.map((r) => (
                <div key={r.description} className="border-t border-line py-2 text-[13.5px] first:border-t-0">
                  {r.description.replace(/ \((finding|procedure|disorder)\)$/, "")}
                </div>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div key="closed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid gap-2.5">
            <span className="label flex items-center gap-1.5">
              <Lock className="size-3" strokeWidth={1.6} />
              {chart.sensitive_record_count} records hidden
            </span>
            <div className="grid gap-1.5">
              {[82, 64].map((w) => (
                <i key={w} className="block h-[9px] rounded-[3px] bg-[repeating-linear-gradient(90deg,var(--line)_0_8px,transparent_8px_11px)]" style={{ width: `${w}%` }} />
              ))}
            </div>
            {stage === "closed" ? (
              <button
                onClick={() => setStage("reason")}
                className="justify-self-start rounded-full border border-edge px-3 py-1.5 text-[13px] font-normal transition-colors hover:border-accent hover:text-accent"
              >
                Break the glass
              </button>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reason.trim()) open();
                }}
                className="flex gap-2"
              >
                <input
                  autoFocus
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason, e.g. unresponsive, need full history"
                  className="min-w-0 flex-1 rounded-full border border-edge bg-transparent px-3 py-1.5 text-[13px] outline-none focus:border-accent"
                />
                <button
                  disabled={!reason.trim() || stage === "loading"}
                  className="rounded-full bg-accent px-3 py-1.5 text-[13px] font-normal text-white disabled:opacity-40"
                >
                  {stage === "loading" ? "Opening" : "Open"}
                </button>
              </form>
            )}
            {stage === "error" && <span className="text-[12.5px] text-accent">{error}</span>}
            <p className="text-[12px] leading-normal text-mute">Mental health, substance use and similar records. Every access is logged.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <h5 className="label flex justify-between">
        <span>{title}</span>
        {aside && <span>{aside}</span>}
      </h5>
      <div className="grid">{children}</div>
    </div>
  );
}

function Row({ children, aside, title }: { children: React.ReactNode; aside?: string; title?: string }) {
  return (
    <div title={title} className="grid grid-cols-[1fr_auto] gap-3 border-t border-line py-2.5 text-[14px] last:border-b">
      <span>{children}</span>
      {aside && <span className="text-right font-mono text-[11px] leading-[1.6] tracking-[.03em] text-mute">{aside}</span>}
    </div>
  );
}
