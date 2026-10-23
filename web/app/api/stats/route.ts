import { connection } from "next/server";
import { sql } from "@/lib/snowflake";
import type { Stats } from "@/lib/types";

// Headline numbers and the demo clock, from HEALTHLINE.GOLD.STATS and CLOCK.
export async function GET() {
  await connection();
  try {
    const [row] = await sql<Stats>(`
      SELECT s.*, TO_VARCHAR(k.as_of, 'YYYY-MM-DD HH24:MI:SS') AS as_of, k.er_site_name, k.metro
      FROM HEALTHLINE.GOLD.STATS s CROSS JOIN HEALTHLINE.GOLD.CLOCK k`);
    return Response.json(row);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
