"use client";

import { BatteryFull, SignalHigh, Wifi } from "lucide-react";
import clsx from "clsx";
import type { Persona } from "@/lib/personas";

// Design size in real phone proportions; TeamApp scales all three together to fill the screen height.
export const PHONE = { width: 430, height: 860, label: 36, gap: 56 };

/** A phone for one persona: its own palette (via data-persona), a role label above for the audience. */
export function PhoneFrame({ persona, fresh, children }: { persona: Persona; fresh: boolean; children: React.ReactNode }) {
  return (
    <div data-persona={persona.id} className="flex flex-col items-center" style={{ width: PHONE.width }}>
      <div className="flex items-baseline gap-2.5" style={{ height: PHONE.label }}>
        <span className="font-mono text-[15px] font-medium tracking-[.12em] uppercase" style={{ color: persona.tint }}>
          {persona.role}
        </span>
        <span className="font-serif text-[20px] text-mute italic">{persona.scene}</span>
      </div>

      <div
        className={clsx(
          "relative overflow-hidden rounded-[46px] border-[10px] border-[#111] bg-paper shadow-[0_30px_60px_-30px_rgba(0,0,0,.55),0_0_0_1px_rgba(0,0,0,.4)] transition-shadow duration-500",
          fresh && "shadow-[0_0_0_5px_var(--accent),0_0_40px_6px_var(--glow),0_30px_60px_-30px_rgba(0,0,0,.55)]",
        )}
        style={{ width: PHONE.width, height: PHONE.height }}
      >
        {fresh && <div aria-hidden className="pointer-events-none absolute inset-0 z-30 animate-[ring_1.6s_ease-out_infinite] rounded-[36px] shadow-[inset_0_0_0_3px_var(--accent)]" />}

        {/* Status bar and Dynamic Island, on the persona's band colour. */}
        <div className="relative flex h-[34px] items-center justify-between bg-[var(--band)] px-7 text-[12.5px] font-medium text-white">
          <span className="tabular-nums">9:41</span>
          <span aria-hidden className="absolute top-[7px] left-1/2 h-[22px] w-[96px] -translate-x-1/2 rounded-full bg-black" />
          <span className="flex items-center gap-1">
            <SignalHigh className="size-3.5" strokeWidth={2} />
            <Wifi className="size-3.5" strokeWidth={2} />
            <BatteryFull className="size-4" strokeWidth={1.8} />
          </span>
        </div>

        <div className="flex h-[calc(100%-34px)] flex-col">{children}</div>
      </div>
    </div>
  );
}
