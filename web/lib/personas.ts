// One agent, three people. Each message to ER_ASSISTANT says who is speaking; the first message of a
// case also carries the team protocol, so the deployed agent needs no changes.

export type PersonaId = "paramedic" | "doctor" | "nurse";

export type Persona = {
  id: PersonaId;
  role: string;
  name: string;
  initials: string;
  where: string;
  placeholder: string;
  tint: string;
  /** What this person needs from a reply in the single-user view. */
  focus: string;
  /** Home suggestions in the single-user view. */
  suggestions: { label: string; prompt: string }[];
};

export const BAY4_STORY =
  "Unconscious male, early 40s, about 177 cm. Nitroglycerin spray and a MetroHealth slip in his jacket. Found in Cleveland.";

const BAY2 = { label: "Brief me on bay 2", prompt: "Brief me on bay 2" };
const ALLERGY = { label: "Who’s waiting with a severe allergy?", prompt: "Who's waiting with a severe allergy?" };
const THINNERS = { label: "Who on the board is on blood thinners?", prompt: "Who on the ER board is on a blood thinner?" };

export const PERSONAS: Record<PersonaId, Persona> = {
  paramedic: {
    id: "paramedic",
    role: "Paramedic",
    name: "Medic Rivera",
    initials: "MR",
    where: "Unit 12 · en route",
    placeholder: "Field report, vitals, what you found",
    tint: "#2f7de1",
    focus:
      "I'm in the field or en route. Lead with what changes care before arrival: who they most likely are, blood thinners, severe allergies and cardiac drugs. Be even shorter than usual.",
    suggestions: [{ label: "Unresponsive male, early 40s, nitroglycerin spray", prompt: BAY4_STORY }, THINNERS, BAY2],
  },
  doctor: {
    id: "doctor",
    role: "Doctor",
    name: "Dr. Okafor",
    initials: "RO",
    where: "Emergency medicine",
    placeholder: "Ask anything, or tell the nurse what to prepare",
    tint: "#ec4f2a",
    focus: "Focus on what changes diagnosis and treatment decisions.",
    suggestions: [{ label: "Unconscious male, early 40s, nitroglycerin spray", prompt: BAY4_STORY }, BAY2, ALLERGY],
  },
  nurse: {
    id: "nurse",
    role: "Nurse",
    name: "RN Chen",
    initials: "LC",
    where: "Resus bay 4",
    placeholder: "Ask about prep, allergies, access, meds",
    tint: "#1f9d74",
    focus: "Focus on medications, allergies, the vitals to watch and the nursing tasks that follow. Keep to the usual length.",
    suggestions: [BAY2, ALLERGY, THINNERS],
  },
};

export const ORDER: PersonaId[] = ["paramedic", "doctor", "nurse"];

export const FIELD_REPORT =
  "Unit 12 inbound, ETA 6 min. Unconscious male, early 40s, about 177 cm, found outside in Cleveland. BP 88/50, HR 124, GCS 8. Nitroglycerin spray and a MetroHealth slip in his jacket. We gave 324 mg aspirin en route.";

export const TEAM_RULES = `Team mode. You are Healthline, one assistant serving an ER team on a shared case. Every message starts with a tag naming who is speaking:
- [Paramedic] is in the ambulance. Reply in at most two short lines they can act on in the field.
- [Doctor] is the ER physician. Reply clinically and briefly.
- [Nurse] is preparing the bay. Reply about preparation, logistics, allergies, access and drug safety.
- [Monitor] is the ambulance monitor raising an alarm on its own: nobody asked. Treat it as the moment a busy team would miss the trend. Reply to the paramedic in one line they can act on now, alert the doctor with a critical or high handoff that says what the trend means for this patient's chart and medications and what to start on arrival, give the nurse tasks for anything to have ready, and add catches.
Reply only to the person who spoke, and never start your reply with a [tag]. [Team update] lines are status notes from the team, including the latest monitor reading; take them into account.

Coordinate the team with fenced blocks at the end of your reply, after any text and before any options block:
1. When the paramedic's report gives a likely identity, a chart or a critical finding, alert the doctor:
\`\`\`handoff
{"to": "doctor", "priority": "critical", "title": "Unit 12: likely <name>, <key danger>", "summary": "Two lines on who is coming, what is dangerous and what to decide."}
\`\`\`
priority is critical, high or routine. "to" can be doctor, nurse or paramedic.
2. When the doctor asks for anything to be prepared, ordered or done, turn it into tasks for the nurse, each with a short reason from the chart:
\`\`\`tasks
{"to": "nurse", "items": [{"task": "<what to prepare>", "why": "<reason from the chart>"}]}
\`\`\`
Also send the doctor a handoff when the nurse reports something the doctor must know.
Never say a task is done, ready or confirmed unless a [Team update] or the person speaking said so. A question is not a status report: answer it, and don't send the doctor a status handoff for it. When unsure, say what is still outstanding.
3. After every chart, field report or clinical question, add what a busy human could miss, grounded only in tool results and the conversation (never invent prices or facts):
\`\`\`catches
[{"kind": "safety", "text": "<one sentence>"}]
\`\`\`
kind is safety (interactions, allergies, field drugs against the chart, anticoagulants, hidden records), time (records already at another care site, steps that can start before arrival), cost (tests done recently elsewhere that need not be repeated, avoidable admissions) or research (one population fact from ask_data that changes a decision). Give 1 to 4 catches, most important first, one sentence each. Don't repeat a catch already made in this case.
JSON in these blocks must be valid. Keep the options block format as before when you ask a question.`;

export const MONITOR = "Monitor · Unit 12 telemetry";

export function tagged(persona: PersonaId, text: string, updates: string[], first: boolean, auto = false) {
  const p = PERSONAS[persona];
  const lines = [
    ...(first ? [TEAM_RULES, ""] : []),
    ...updates.map((u) => `[Team update] ${u}`),
    `[${auto ? MONITOR : `${p.role} · ${p.name}`}] ${text}`,
  ];
  return lines.join("\n");
}

/** The single-user view: say who is asking without the team tags, which switch the agent into team mode. */
export function solo(persona: PersonaId, text: string) {
  const p = PERSONAS[persona];
  return `(Asked by ${p.name}, ${p.role.toLowerCase()}, ${p.where}. ${p.focus})\n${text}`;
}
