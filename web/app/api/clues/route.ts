import { sql } from "@/lib/snowflake";
import type { ParsedClues } from "@/lib/types";

// Turns a paramedic's words into identify arguments with Claude (HEALTHLINE.GOLD.PARSE_CLUES).
export async function POST(request: Request) {
  const { text } = (await request.json()) as { text: string };
  if (!text?.trim()) return Response.json({ error: "text is required" }, { status: 400 });
  try {
    const [row] = await sql<{ parse_clues: ParsedClues }>("CALL HEALTHLINE.GOLD.PARSE_CLUES(?)", [text.trim().slice(0, 1000)]);
    return Response.json(row.parse_clues);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
