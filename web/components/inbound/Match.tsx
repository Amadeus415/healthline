"use client";

import { motion } from "motion/react";
import { Check } from "lucide-react";
import clsx from "clsx";
import { ease } from "./parts";
import type { Candidate, IdentifyResult, Stats } from "@/lib/types";

type Props = {
  result: IdentifyResult;
  stats: Stats | null;
  confirmed: { patient_id: number; at: string } | null;
  confirming: boolean;
  onConfirm: (c: Candidate) => void;
};

const initials = (c: Candidate) => `${(c.first_name ?? c.name)[0]}${(c.last_name ?? c.name.split(" ").at(-1) ?? "")[0]}`;
const her = (c: Candidate) => (c.gender === "F" ? "she" : c.gender === "M" ? "he" : "they");

/** The short list, ranked, with the reasons for the leader. The AI suggests; the nurse decides. */
export function MatchView({ result, stats, confirmed, confirming, onConfirm }: Props) {
  const list = result.candidates.slice(0, 5);
  const top = list[0];
  if (!top) return <p className="text-[16px] text-mute">Nobody matches every clue. Loosen one and try again.</p>;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_350px]">
      <div className="grid content-start gap-2">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="label">
          {result.total_matches} {result.total_matches === 1 ? "candidate" : "candidates"} · ranked by what we can see
        </motion.div>
        <motion.h2 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease }} className="pb-3 font-serif text-[46px] leading-none tracking-[-.02em]">
          Who is <em>{her(top)}</em>?
        </motion.h2>
        {list.map((c, i) => {
          const lead = i === 0;
          const done = confirmed?.patient_id === c.patient_id;
          return (
            <motion.div
              key={c.patient_id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: confirmed && !done ? 0.4 : 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 + i * 0.12, ease }}
              className={clsx(
                "grid grid-cols-[46px_minmax(0,1fr)_minmax(80px,200px)_52px] items-center gap-4 rounded-2xl border px-4 py-3.5 transition-[border-color,box-shadow] duration-500",
                done ? "border-ink shadow-[0_0_0_4px_var(--line)]" : lead ? "border-accent" : "border-line",
              )}
            >
              <span
                className={clsx(
                  "grid size-[46px] place-items-center rounded-full font-mono text-[13px] transition-colors duration-500",
                  done ? "bg-ink text-paper" : lead ? "bg-accent text-white" : "border border-edge text-mute",
                )}
              >
                {done ? <Check className="size-5" strokeWidth={2} /> : initials(c)}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[18px] font-normal">
                  {c.first_name ?? c.name} <em>{c.last_name}</em>
                </div>
                <div className="truncate text-[13px] text-mute">
                  {c.age} · {c.height_cm ? `${c.height_cm} cm` : "height unknown"} · zip {c.zip}
                  {c.notable_medications[0] && ` · ${c.notable_medications[0].toLowerCase()}`}
                </div>
              </div>
              <span className="relative h-[3px] rounded-full bg-line">
                <motion.i
                  className={clsx("absolute top-0 left-0 h-full rounded-full", lead ? "bg-accent" : "bg-ink/50")}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(c.probability * 100, 1.5)}%` }}
                  transition={{ duration: 1.1, delay: 0.5 + i * 0.12, ease }}
                />
              </span>
              <b className={clsx("text-right font-mono text-[14px] font-normal tabular-nums", lead && "text-accent")}>{c.probability.toFixed(2)}</b>
            </motion.div>
          );
        })}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 1.2, ease }}
        className="grid content-start gap-2 rounded-[22px] border border-line bg-raise p-5"
      >
        <span className="label">Why {top.first_name ?? top.name}</span>
        {(top.reasons ?? []).map((r) => (
          <div key={r.text} className="flex items-center justify-between gap-3 border-t border-line py-2.5 text-[14.5px]">
            <span>{r.text}</span>
            <span className={clsx("font-mono text-[10.5px] tracking-[.06em] uppercase", r.strength === "strong" ? "text-accent" : "text-mute")}>{r.strength}</span>
          </div>
        ))}
        {stats && (
          <p className="rounded-xl border border-dashed border-edge px-3 py-2.5 text-[13px] leading-snug text-mute">
            No SSN used. In this data {(stats.patients / 1e6).toFixed(2)}M patients share {Math.round(stats.distinct_ssns / 1000)}K SSNs.
          </p>
        )}
        <button
          disabled={!!confirmed || confirming}
          onClick={() => onConfirm(top)}
          className={clsx(
            "mt-2 flex h-[52px] items-center justify-center gap-2 rounded-[14px] text-[16px] font-normal transition-all duration-300 active:scale-[.97]",
            confirmed ? "bg-ink text-paper" : "bg-accent text-white shadow-[0_10px_24px_-10px_var(--accent)]",
          )}
        >
          {confirmed ? (
            <>
              <Check className="size-4" strokeWidth={2} /> Confirmed by triage nurse · {confirmed.at}
            </>
          ) : confirming ? (
            "Confirming…"
          ) : (
            `Confirm ${top.first_name ?? top.name}`
          )}
        </button>
        <span className="text-center font-mono text-[10px] tracking-[.06em] text-mute uppercase">
          {confirmed ? "Logged to IDENTITY_LOG" : "The AI suggests · a person decides"}
        </span>
      </motion.div>
    </div>
  );
}
