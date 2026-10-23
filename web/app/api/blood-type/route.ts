import { connection } from "next/server";
import { sql } from "@/lib/snowflake";
import type { BloodType } from "@/lib/types";

// The patient's blood group on file, from HEALTHFORCE.CLINICAL.PATIENT_BLOOD_TYPE (synthetic: Synthea has none).
export async function GET(request: Request) {
  await connection();
  const id = Number(new URL(request.url).searchParams.get("patientId"));
  if (!Number.isInteger(id)) return Response.json({ error: "patientId is required" }, { status: 400 });
  try {
    const [row] = await sql<BloodType>(
      `SELECT patient_id, abo_rh, TO_CHAR(tested_on, 'YYYY-MM-DD') AS tested_on, care_site, synthetic
       FROM HEALTHFORCE.CLINICAL.PATIENT_BLOOD_TYPE WHERE patient_id = ?`,
      [id],
    );
    return Response.json({ blood: row ?? null });
  } catch (e) {
    return Response.json({ error: (e as Error).message, blood: null }, { status: 502 });
  }
}
