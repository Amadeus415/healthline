import { sql } from "@/lib/snowflake";

// Emergency access to hidden records. BREAK_GLASS logs every call to HEALTHLINE.GOLD.ACCESS_LOG.
export async function POST(request: Request) {
  const { patientId, reason, clinician } = (await request.json()) as {
    patientId: number;
    reason: string;
    clinician: string;
  };
  if (!Number.isInteger(patientId) || !reason?.trim()) {
    return Response.json({ error: "patientId and reason are required" }, { status: 400 });
  }
  try {
    const [row] = await sql<{ break_glass: { records: { description: string; kind: string }[]; logged_at: string } }>(
      "CALL HEALTHLINE.GOLD.BREAK_GLASS(?, ?, ?)",
      [patientId, reason.trim().slice(0, 500), (clinician ?? "unknown").slice(0, 100)],
    );
    return Response.json(row.break_glass);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
