"use client";

import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { forwardRef } from "react";
import { Composer, type ComposerHandle } from "./Composer";
import { Mark } from "./Mark";
import type { Persona } from "@/lib/personas";

const ease = [0.2, 0.7, 0.2, 1] as const;

type Props = { bay?: number; suggestions: Persona["suggestions"]; onSend: (text: string) => void };

export const Home = forwardRef<ComposerHandle, Props>(function Home({ bay, suggestions, onSend }, ref) {
  return (
    <section className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 pb-16">
      {/* A slow accent glow behind the greeting. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-[18%] left-1/2 h-[420px] w-[720px] -translate-x-1/2 animate-[drift_18s_ease-in-out_infinite] rounded-full bg-[radial-gradient(closest-side,var(--glow),transparent)] blur-2xl" />
        <div className="absolute inset-0 bg-[radial-gradient(var(--line)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)] bg-[size:22px_22px] opacity-60" />
      </div>

      <motion.h1
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease }}
        className="relative mb-[34px] flex items-center gap-[18px] text-center font-serif text-[clamp(40px,4.6vw,58px)] leading-[1.05] tracking-[-.02em]"
      >
        <Mark className="size-11 flex-none" />
        {bay ? (
          <span>
            Who’s in <em>bay {bay}</em>?
          </span>
        ) : (
          <span>
            Who’s <em>in front of you</em>?
          </span>
        )}
      </motion.h1>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.1, ease }}
        className="relative w-full max-w-[760px]"
      >
        <Composer ref={ref} large placeholder="Describe the patient, or ask about anyone in the ER" onSend={onSend} />
        <div className="mt-[42px] grid">
          {suggestions.map((s, i) => (
            <motion.button
              key={s.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.25 + i * 0.07, ease }}
              onClick={() => onSend(s.prompt)}
              className="group grid grid-cols-[1fr_auto] items-center gap-5 border-t border-line px-1 py-[15px] text-left text-[16px] transition-[padding] duration-300 last:border-b hover:pl-3"
            >
              <span>{s.label}</span>
              <ArrowRight className="size-[18px] text-mute transition-[transform,color] duration-300 group-hover:translate-x-[3px] group-hover:text-accent" strokeWidth={1.5} />
            </motion.button>
          ))}
        </div>
        <div className="label mt-7 text-center">Cortex Agent on Snowflake · 1.42M patients · 12 cities · synthetic data</div>
      </motion.div>
    </section>
  );
});
