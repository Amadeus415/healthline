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
  scene: string;
};

export const PERSONAS: Record<PersonaId, Persona> = {
  paramedic: {
    id: "paramedic",
    role: "Paramedic",
    name: "Medic Rivera",
    initials: "MR",
    where: "Unit 12 · en route",
    placeholder: "Field report, vitals, what you found",
    tint: "#1f6feb",
    scene: "In the ambulance",
  },
  doctor: {
    id: "doctor",
    role: "Doctor",
    name: "Dr. Okafor",
    initials: "RO",
    where: "Emergency medicine",
    placeholder: "Ask anything, or tell the nurse what to prepare",
    tint: "#e5482a",
    scene: "Emergency department",
  },
  nurse: {
    id: "nurse",
    role: "Nurse",
    name: "RN Chen",
    initials: "LC",
    where: "Resus bay 4",
    placeholder: "Ask about prep, allergies, access, meds",
    tint: "#0e9f77",
    scene: "Resus bay 4",
  },
};

export const ORDER: PersonaId[] = ["paramedic", "doctor", "nurse"];

export const FIELD_REPORT =
  "Unit 12 inbound, ETA 6 min. Unconscious male, early 40s, about 177 cm, found outside in Cleveland. BP 88/50, HR 124, GCS 8. Nitroglycerin spray and a MetroHealth slip in his jacket. We gave 324 mg aspirin en route.";

export const TEAM_RULES = `Team mode. You are HealthForce, one assistant serving an ER team on a shared case. Every message starts with a tag naming who is speaking:
- [Paramedic] is in the ambulance. Reply in at most two short lines they can act on in the field.
- [Doctor] is the ER physician. Reply clinically and briefly.
- [Nurse] is preparing the bay. Reply about preparation, logistics, allergies, access and drug safety.
- [Monitor] is the ambulance monitor raising an alarm on its own: nobody asked. Treat it as the moment a busy team would miss the trend. Reply to the paramedic in one line they can act on now, alert the doctor with a critical or high handoff that says what the trend means for this patient's chart and medications and what to start on arrival, give the nurse tasks for anything to have ready.
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
3. After every chart, field report or clinical question, end your text with what a busy human could miss: 1 to 3 short bullets, each starting with a bold key term (an interaction, a drug against the chart, records at another care site, a test that need not be repeated). Ground them only in tool results and the conversation; never invent prices or facts, and don't repeat one already made in this case.
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
