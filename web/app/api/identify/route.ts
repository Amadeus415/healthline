import { sql } from "@/lib/snowflake";
import type { IdentifyArgs, IdentifyResult } from "@/lib/types";

// Runs HEALTHLINE.GOLD.IDENTIFY_PATIENT directly, so each clue updates the funnel in a second or two.
const ORDER: (keyof IdentifyArgs)[] = [
  "city", "gender", "age_min", "age_max", "height_min", "height_max", "zip",
  "medications", "care_site", "name", "first_initial", "has_marks", "ruled_out_marks",
];

export async function POST(request: Request) {
  const args = (await request.json()) as Partial<IdentifyArgs>;
  const binds = ORDER.map((k) => {
    const v = args[k];
    if (/_(min|max)$/.test(k)) return Number(v) || 0;
    return String(v ?? "").slice(0, 200);
  });
  try {
    const [row] = await sql<{ identify_patient: IdentifyResult }>(
      `CALL HEALTHLINE.GOLD.IDENTIFY_PATIENT(${ORDER.map(() => "?").join(", ")})`,
      binds,
    );
    return Response.json(row.identify_patient);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
