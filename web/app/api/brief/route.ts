import { sql } from "@/lib/snowflake";
import type { Brief } from "@/lib/types";

// The unified record and pre-arrival brief (HEALTHLINE.GOLD.GET_ER_BRIEF).
export async function POST(request: Request) {
  const { patientId, complaint } = (await request.json()) as { patientId: number; complaint?: string };
  if (!Number.isInteger(patientId)) return Response.json({ error: "patientId is required" }, { status: 400 });
  try {
    const [row] = await sql<{ get_er_brief: Brief }>("CALL HEALTHLINE.GOLD.GET_ER_BRIEF(?, ?)", [
      patientId,
      (complaint ?? "").slice(0, 200),
    ]);
    return Response.json(row.get_er_brief);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
