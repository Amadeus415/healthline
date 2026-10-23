// A simulated ambulance monitor. The trajectory is scripted so the demo is repeatable: the patient
// slowly decompensates (BP 88/50 → 76/42, HR climbs, SpO2 slips). Simple threshold rules decide when to
// alert; the agent decides what it means for the team.

export type Vitals = { tick: number; sbp: number; dbp: number; hr: number; spo2: number; rr: number };

export const TICK_MS = 1500;
export const LAST_TICK = 80;

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// Small deterministic wobble so the numbers look like a monitor, not a line.
const wobble = (tick: number, seed: number) => Math.round(Math.sin(tick * 1.7 + seed) * 1.2);

export function vitalsAt(tick: number): Vitals {
  const drop = ease(tick / 42);
  const late = ease((tick - 30) / 26);
  return {
    tick,
    sbp: Math.round(88 - 12 * drop) + wobble(tick, 1),
    dbp: Math.round(50 - 8 * drop) + wobble(tick, 2),
    hr: Math.round(124 + 10 * drop) + wobble(tick, 3),
    spo2: Math.min(99, Math.round(96 - 5 * late + wobble(tick, 4) * 0.5)),
    rr: Math.round(22 + 5 * drop),
  };
}

export const bp = (v: Vitals) => `${v.sbp}/${v.dbp}`;

export type Trigger = { id: string; label: string; message: string };

/** Rules a monitor would alarm on. Each fires once per case. */
export function checkTriggers(history: Vitals[], fired: string[]): Trigger[] {
  const now = history.at(-1);
  const start = history[0];
  if (!now || !start) return [];
  const seconds = Math.round(((now.tick - start.tick) * TICK_MS) / 1000);
  const trend = (pick: (v: Vitals) => string | number) =>
    history
      .filter((_, i, all) => i % Math.max(1, Math.floor(all.length / 6)) === 0 || i === all.length - 1)
      .map(pick)
      .join(" → ");

  const out: Trigger[] = [];
  if (!fired.includes("hypotension") && now.sbp <= 80 && start.sbp - now.sbp >= 8) {
    out.push({
      id: "hypotension",
      label: `BP falling ${bp(start)} → ${bp(now)}`,
      message: `Telemetry alert, raised automatically; no one has asked about it. Over the last ${seconds}s: BP ${trend(bp)}, HR ${trend((v) => v.hr)}, SpO2 ${trend((v) => `${v.spo2}%`)}, RR ${now.rr}. Pressure is falling despite field treatment.`,
    });
  }
  if (!fired.includes("hypoxia") && now.spo2 <= 92) {
    out.push({
      id: "hypoxia",
      label: `SpO2 down to ${now.spo2}%`,
      message: `Telemetry alert, raised automatically. SpO2 ${trend((v) => `${v.spo2}%`)} over ${seconds}s, RR ${now.rr}, BP ${bp(now)}, HR ${now.hr}.`,
    });
  }
  return out;
}

/** One line of current vitals for the agent's context on every human message. */
export function vitalsLine(history: Vitals[]) {
  const now = history.at(-1);
  const start = history[0];
  if (!now || !start) return null;
  return `Monitor now: BP ${bp(now)} (was ${bp(start)}), HR ${now.hr}, SpO2 ${now.spo2}%, RR ${now.rr}.`;
}
