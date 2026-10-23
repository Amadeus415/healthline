"use client";

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { CountUp, ease } from "./parts";
import type { Brief } from "@/lib/types";

// Where each care site sits around the patient, as % of the canvas: biggest first.
const SPOTS = [
  [19, 14],
  [81, 14],
  [13, 49],
  [87, 49],
  [19, 85],
  [81, 85],
  [50, 6],
  [50, 94],
];
const CENTER = [50, 49];

/** One record from many care sites: the sites arrive one by one and link to the patient. */
export function RecordView({ brief }: { brief: Brief }) {
  const sites = brief.sites.slice(0, SPOTS.length);
  const step = 0.55;
  const done = 0.6 + sites.length * step;
  // Lines are drawn in pixels so the draw-on animation isn't stretched by the canvas shape.
  const canvas = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const px = (x: number, y: number) => [(x / 100) * size.w, (y / 100) * size.h];

  return (
    <div className="grid gap-6">
      <div ref={canvas} className="relative hidden h-[540px] md:block">
        {size.w > 0 && (
          <svg viewBox={`0 0 ${size.w} ${size.h}`} className="absolute inset-0 size-full" aria-hidden>
            {sites.map((s, i) => {
              const [x1, y1] = px(CENTER[0], CENTER[1]);
              const [x2, y2] = px(SPOTS[i][0], SPOTS[i][1]);
              return (
                <motion.line
                  key={s.site_id}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  className={clsx(s.key || s.here ? "stroke-accent" : "stroke-[var(--edge)]")}
                  strokeWidth={1.2}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.8, delay: 0.6 + i * step, ease }}
                />
              );
            })}
          </svg>
        )}

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease }}
          className="absolute grid w-[250px] -translate-x-1/2 -translate-y-1/2 gap-1 rounded-[22px] border border-edge bg-raise px-5 py-5 text-center shadow-[0_0_0_8px_var(--accent-soft),0_30px_60px_-30px_rgba(0,0,0,.35)]"
          style={{ left: `${CENTER[0]}%`, top: `${CENTER[1]}%` }}
        >
          <span className="label">One record</span>
          <span className="text-[24px] leading-tight font-light tracking-[-.02em]">
            {brief.patient.first_name} <em>{brief.patient.last_name}</em>
          </span>
          <CountUp value={brief.visits_total} from={0} duration={done - 0.6} delay={0.6} className="text-[54px] leading-none font-extralight tracking-[-.04em] tabular-nums" />
          <span className="text-[13px] text-mute">
            visits from <CountUp value={sites.length} from={0} duration={done - 0.6} delay={0.6} /> care sites
          </span>
        </motion.div>

        {sites.map((s, i) => (
          <motion.div
            key={s.site_id}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.9 + i * step, ease }}
            className={clsx(
              "absolute grid w-[240px] -translate-x-1/2 -translate-y-1/2 gap-1 rounded-2xl border bg-raise px-4 py-3",
              s.key ? "border-accent" : s.here ? "border-dashed border-accent" : "border-line",
            )}
            style={{ left: `${SPOTS[i][0]}%`, top: `${SPOTS[i][1]}%` }}
          >
            <SiteBody site={s} />
          </motion.div>
        ))}
      </div>

      {/* Narrow screens: the same record as a list. */}
      <div className="grid md:hidden">
        <div className="pb-3 text-[22px] font-light">
          {brief.patient.first_name} <em>{brief.patient.last_name}</em>
          <span className="text-mute"> · {brief.visits_total} visits</span>
        </div>
        {sites.map((s) => (
          <div key={s.site_id} className="grid gap-1 border-t border-line py-3 last:border-b">
            <SiteBody site={s} />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap justify-center gap-2.5">
        {brief.cleanup.map((c, i) => (
          <motion.span
            key={c.name}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: done + 0.6 + i * 0.3, ease }}
            className="inline-flex items-center gap-2 rounded-full border border-edge px-3.5 py-2 text-[13.5px]"
          >
            <span className="font-mono text-[10.5px] tracking-[.06em] text-mute uppercase">Cleanup</span>
            {c.text}
          </motion.span>
        ))}
        {!brief.here.has_blood_thinner_on_file && brief.alerts.some((a) => /bleeding/i.test(a.title)) && (
          <motion.span
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: done + 2, ease }}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-3.5 py-2 text-[13.5px] text-white"
          >
            <span className="font-mono text-[10.5px] tracking-[.06em] uppercase opacity-80">This ER</span>
            Our own chart has no blood thinner on file
          </motion.span>
        )}
      </div>
    </div>
  );
}

function SiteBody({ site }: { site: Brief["sites"][number] }) {
  return (
    <>
      <span className="flex items-baseline justify-between gap-2">
        <b className="truncate text-[14.5px] font-normal">{site.name}</b>
        {site.merged && <span className="flex-none font-mono text-[9.5px] tracking-[.06em] text-mute uppercase">{site.organization_ids.length} IDs merged</span>}
      </span>
      <span className={clsx("font-mono text-[10.5px] tracking-[.04em]", site.here ? "text-accent" : "text-mute")}>
        {site.here ? "This ER · " : ""}
        {site.visits} {site.visits === 1 ? "visit" : "visits"}
        {site.city && ` · ${site.city}`}
      </span>
      <span className={clsx("text-[13px] leading-snug", site.key && "text-accent")}>{site.highlight}</span>
    </>
  );
}
