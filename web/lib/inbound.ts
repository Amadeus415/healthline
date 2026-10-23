import type { IdentifyArgs, NextQuestion, ParsedClues } from "./types";

// The ambulance countdown: Medic 14 radios in an unknown woman with a head injury. The radio call
// and what the paramedic can see are scripted; every count, name and record comes from Snowflake.

export const RADIO = "Female, mid-50s. Fall with head strike, confused. No wallet, no ID. ETA 8 minutes.";
export const ETA_SECONDS = 8 * 60;
/** Story seconds per real second, so eight minutes of ambulance plays in about a minute and a half. */
export const SPEED = 5;

/** kind is the question a clue answers, when it answers one. */
export type Clue = { id: string; label: string; value: string; args: Partial<IdentifyArgs>; from: "radio" | "paramedic" | "typed"; kind?: NextQuestion["clue"] };

/** What the paramedic can see, by the question it answers. Care site is missing: she has no cards. */
export const VISIBLE: Partial<Record<NextQuestion["clue"], Omit<Clue, "id" | "from" | "kind">>> = {
  zip: { label: "Found at", value: "Zip 44121", args: { zip: "44121" } },
  height: { label: "Height", value: "About 155 cm", args: { height_min: 150, height_max: 160 } },
  medication: { label: "Pill bottle", value: "Clopidogrel 75 mg", args: { medications: "clopidogrel" } },
  first_initial: { label: "Bracelet", value: "Engraved “T”", args: { first_initial: "T" } },
};

/** Clues the paramedic offers before anyone asks. */
export const VOLUNTEERED: NextQuestion["clue"][] = ["zip", "height"];

export const EMPTY_ARGS: IdentifyArgs = {
  city: "",
  gender: "",
  age_min: 0,
  age_max: 0,
  height_min: 0,
  height_max: 0,
  zip: "",
  medications: "",
  care_site: "",
  name: "",
  first_initial: "",
  has_marks: "",
  ruled_out_marks: "",
};

/** Later clues override earlier ones; medications and marks add up. */
export function mergeArgs(clues: Clue[], city: string): IdentifyArgs {
  const out: IdentifyArgs = { ...EMPTY_ARGS, city };
  for (const c of clues) {
    for (const [k, v] of Object.entries(c.args) as [keyof IdentifyArgs, string | number][]) {
      if (v === "" || v === 0 || v === undefined) continue;
      if (k === "medications" || k === "has_marks" || k === "ruled_out_marks") {
        const list = new Set([...String(out[k]).split(","), ...String(v).split(",")].map((s) => s.trim().toLowerCase()).filter(Boolean));
        out[k] = [...list].join(",");
      } else {
        (out as Record<string, string | number>)[k] = v;
      }
    }
  }
  return out;
}

/** Turns what PARSE_CLUES heard into clue rows a person can read. */
export function cluesFromParse(parsed: ParsedClues, from: Clue["from"], uid: () => string): Clue[] {
  const out: Clue[] = [];
  const add = (label: string, value: string, args: Partial<IdentifyArgs>) => out.push({ id: uid(), label, value, args, from });
  const g = String(parsed.gender ?? "").toUpperCase();
  if (g === "F" || g === "M") add("Sex", g === "F" ? "Female" : "Male", { gender: g });
  if (parsed.age_min || parsed.age_max) add("Age", `${parsed.age_min || "?"} to ${parsed.age_max || "?"}`, { age_min: parsed.age_min, age_max: parsed.age_max });
  if (parsed.height_min || parsed.height_max)
    add("Height", `${parsed.height_min || "?"} to ${parsed.height_max || "?"} cm`, { height_min: parsed.height_min, height_max: parsed.height_max });
  if (parsed.zip) add("Found at", `Zip ${parsed.zip}`, { zip: parsed.zip });
  if (parsed.medications) add("Medication", parsed.medications, { medications: parsed.medications });
  if (parsed.first_initial) add("Initial", `“${parsed.first_initial.toUpperCase()}”`, { first_initial: parsed.first_initial });
  if (parsed.name) add("Name", parsed.name, { name: parsed.name });
  if (parsed.care_site) add("Care site", parsed.care_site, { care_site: parsed.care_site });
  if (parsed.marks) add("Marks", parsed.marks, { has_marks: parsed.marks });
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "06:21:14" from seconds since midnight. */
export function hms(seconds: number) {
  const s = Math.floor(seconds);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** "7:42" from seconds. */
export function mmss(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** Seconds since midnight of "2024-09-23 06:21:14". */
export function secondsOfDay(ts: string) {
  const [, h, m, s] = ts.match(/(\d{2}):(\d{2}):(\d{2})/) ?? [];
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}
