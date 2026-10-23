"use client";

import { AnimatePresence, motion } from "motion/react";
import { FastForward, Pause, Play } from "lucide-react";
import clsx from "clsx";
import { bp, type Vitals } from "@/lib/vitals";

type Reading = { label: string; value: string; unit: string; series: number[]; bad: boolean; down?: boolean };

function readings(history: Vitals[]): Reading[] {
  const now = history.at(-1)!;
  const start = history[0];
  return [
    { label: "BP", value: bp(now), unit: "mmHg", series: history.map((v) => v.sbp), bad: now.sbp < 90, down: now.sbp < start.sbp - 3 },
    { label: "HR", value: String(now.hr), unit: "bpm", series: history.map((v) => v.hr), bad: now.hr > 120 },
    { label: "SpO2", value: String(now.spo2), unit: "%", series: history.map((v) => v.spo2), bad: now.spo2 < 94, down: now.spo2 < start.spo2 - 1 },
    { label: "RR", value: String(now.rr), unit: "/min", series: history.map((v) => v.rr), bad: now.rr > 24 },
  ];
}

function Spark({ series, bad }: { series: number[]; bad: boolean }) {
  const recent = series.slice(-40);
  const min = Math.min(...recent);
  const max = Math.max(...recent);
  const span = Math.max(max - min, 4);
  const points = recent.map((v, i) => `${(i / Math.max(recent.length - 1, 1)) * 100},${22 - ((v - min) / span) * 20}`).join(" ");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-3.5 w-full">
      <polyline points={points} fill="none" strokeWidth={1.4} vectorEffect="non-scaling-stroke" className={bad ? "stroke-accent" : "stroke-mute"} />
    </svg>
  );
}

type Props = { history: Vitals[]; running: boolean; fast: boolean; alarms: string[]; onToggle: () => void; onFast: () => void };

/** The ambulance monitor, streaming into the paramedic's column. */
export function VitalsMonitor({ history, running, fast, alarms, onToggle, onFast }: Props) {
  if (!history.length) return null;
  const list = readings(history);

  return (
    <div className="flex-none border-b border-line px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className={clsx("size-1.5 rounded-full", running ? "animate-[pulse-dot_1s_infinite] bg-accent" : "bg-mute")} />
        <span className="label">Live monitor · Unit 12</span>
        <div className="ml-auto flex items-center gap-0.5 text-mute">
          <button onClick={onFast} title={fast ? "Normal speed" : "Speed up the feed"} className={clsx("rounded-md p-1.5 hover:bg-line hover:text-ink", fast && "text-accent")}>
            <FastForward className="size-3.5" strokeWidth={1.8} />
          </button>
          <button onClick={onToggle} title={running ? "Pause feed" : "Resume feed"} className="rounded-md p-1.5 hover:bg-line hover:text-ink">
            {running ? <Pause className="size-3.5" strokeWidth={1.8} /> : <Play className="size-3.5" strokeWidth={1.8} />}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {list.map((r) => (
          <div key={r.label} className={clsx("rounded-[9px] border px-2 pt-1 pb-0.5 transition-colors", r.bad ? "border-accent/50 bg-accent-soft" : "border-line bg-raise")}>
            <div className="flex items-baseline justify-between">
              <span className="label">{r.label}</span>
              {r.down && <span className="font-mono text-[10px] text-accent">▼</span>}
            </div>
            <div className={clsx("font-mono text-[16px] leading-tight tabular-nums", r.bad && "text-accent")}>
              {r.value}
              <span className="ml-0.5 text-[10px] text-mute">{r.unit}</span>
            </div>
            <Spark series={r.series} bad={r.bad} />
          </div>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {alarms.map((a) => (
          <motion.div
            key={a}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-1.5 flex items-center gap-2 font-mono text-[11px] text-accent"
          >
            <span className="size-1.5 animate-[pulse-dot_0.8s_infinite] rounded-full bg-accent" />
            Alarm sent to the team · {a}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
