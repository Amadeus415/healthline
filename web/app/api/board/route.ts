import { connection } from "next/server";
import { sql } from "@/lib/snowflake";
import type { Bay } from "@/lib/types";

// Who is in the ER right now, from HEALTHLINE.GOLD.ER_BOARD.
export async function GET() {
  await connection();
  try {
    const bays = await sql<Bay>(`
      SELECT bay, patient_id, patient, age, gender, chief_complaint, acuity, status,
             DATEDIFF('minute', arrived_at, CURRENT_TIMESTAMP()) AS minutes_ago,
             on_blood_thinner, has_severe_allergy
      FROM HEALTHLINE.GOLD.ER_BOARD
      ORDER BY bay`);
    return Response.json({ bays });
  } catch (e) {
    return Response.json({ error: (e as Error).message, bays: [] }, { status: 502 });
  }
}
