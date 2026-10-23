import { runAgent, type AgentMessage } from "@/lib/snowflake";

// Streams the Cortex Agent's server-sent events straight through to the browser.
export async function POST(request: Request) {
  const { messages } = (await request.json()) as { messages: AgentMessage[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages is required" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await runAgent(messages, request.signal);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    return Response.json({ error: `Agent returned ${upstream.status}`, detail }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
