import { sql } from "@/lib/snowflake";

// A clinician confirms an identity. CONFIRM_IDENTITY writes it to HEALTHLINE.GOLD.IDENTITY_LOG.
export async function POST(request: Request) {
  const { patientId, probability, clues, clinician, role } = (await request.json()) as {
    patientId: number;
    probability: number;
    clues: unknown;
    clinician: string;
    role: string;
  };
  if (!Number.isInteger(patientId)) return Response.json({ error: "patientId is required" }, { status: 400 });
  try {
    const [row] = await sql<{ confirm_identity: { confirmed_at: string } }>("CALL HEALTHLINE.GOLD.CONFIRM_IDENTITY(?, ?, ?, ?, ?)", [
      patientId,
      Number(probability) || 0,
      JSON.stringify(clues ?? {}).slice(0, 4000),
      (clinician ?? "unknown").slice(0, 100),
      (role ?? "").slice(0, 50),
    ]);
    return Response.json(row.confirm_identity);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
