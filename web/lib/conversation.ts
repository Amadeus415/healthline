import type { Chart, IdentifyResult } from "./types";

// The conversation model: agent SSE events are folded into turns the UI renders.

export type Step = { id: string; tool: string; label: string; status: "run" | "done" | "error"; startedAt: number; ms?: number };

export type Block =
  | { kind: "text"; index: number; text: string }
  | { kind: "identify"; id: string; data: IdentifyResult }
  | { kind: "table"; id: string; title?: string; columns: string[]; rows: (string | null)[][] }
  | { kind: "chart"; id: string; spec: string };

export type UserTurn = { id: string; role: "user"; text: string };

export type AssistantTurn = {
  id: string;
  role: "assistant";
  status: "streaming" | "done" | "error";
  statusText?: string;
  steps: Step[];
  blocks: Block[];
  patient?: Chart;
  content?: unknown[];
  error?: string;
};

export type Turn = UserTurn | AssistantTurn;

export const uid = () => Math.random().toString(36).slice(2, 10);

export function newAssistantTurn(): AssistantTurn {
  return { id: uid(), role: "assistant", status: "streaming", steps: [], blocks: [] };
}

const RUNNING: Record<string, string> = {
  identify_patient: "Searching patients",
  get_patient_chart: "Building chart",
  ask_data: "Reading the ER data model",
  system_execute_sql: "Querying Snowflake",
  data_to_chart: "Drawing chart",
};

function doneLabel(tool: string, result: unknown): string {
  if (tool === "identify_patient") {
    const r = result as IdentifyResult;
    const searched = r.funnel?.[0]?.count ?? 0;
    return `Searched ${searched.toLocaleString()} patients · ranked ${r.total_matches.toLocaleString()}`;
  }
  if (tool === "get_patient_chart") {
    if ((result as { error?: string }).error) return "No chart found";
    const n = (result as Chart).care_sites?.length ?? 0;
    return `Built chart from ${n} care site${n === 1 ? "" : "s"}`;
  }
  if (tool === "system_execute_sql") return "Queried Snowflake";
  if (tool === "ask_data") return "Read the ER data model";
  if (tool === "data_to_chart") return "Drew chart";
  return tool;
}

/** Generic tools return their procedure's output as a JSON string under `result`. */
function toolJson(content: unknown): unknown {
  const first = (content as { json?: Record<string, unknown> }[] | undefined)?.[0]?.json;
  if (!first) return undefined;
  if (typeof first.result === "string") {
    try {
      return JSON.parse(first.result);
    } catch {
      return first.result;
    }
  }
  return first;
}

type ResultSet = { data: (string | null)[][]; resultSetMetaData: { rowType: { name: string }[] } };

function tableBlock(id: string, rs: ResultSet, title?: string): Block {
  return { kind: "table", id, title, columns: rs.resultSetMetaData.rowType.map((c) => c.name), rows: rs.data };
}

/** Pure reducer: one SSE event in, the next version of the assistant turn out. */
export function applyEvent(turn: AssistantTurn, event: string, data: Record<string, unknown>): AssistantTurn {
  const t: AssistantTurn = { ...turn, steps: [...turn.steps], blocks: [...turn.blocks] };
  switch (event) {
    case "response.status":
      t.statusText = data.message as string;
      return t;

    case "response.tool_use": {
      const tool = data.name as string;
      // The agent's own plumbing (skills, planners) isn't worth showing a clinician.
      if (!(tool in RUNNING) && /^(server|system)_/.test(tool)) return t;
      t.steps.push({ id: data.tool_use_id as string, tool, label: RUNNING[tool] ?? `Running ${tool}`, status: "run", startedAt: Date.now() });
      return t;
    }

    case "response.tool_result": {
      const tool = data.name as string;
      const result = toolJson(data.content);
      const ok = data.status !== "error";
      t.steps = t.steps.map((s) =>
        s.id === data.tool_use_id
          ? { ...s, status: ok ? "done" : "error", ms: Date.now() - s.startedAt, label: ok ? doneLabel(tool, result) : `${s.label} failed` }
          : s,
      );
      if (!ok || !result) return t;
      if (tool === "identify_patient") t.blocks.push({ kind: "identify", id: data.tool_use_id as string, data: result as IdentifyResult });
      if (tool === "get_patient_chart" && !(result as { error?: string }).error) t.patient = result as Chart;
      if (tool === "system_execute_sql") {
        const rs = (result as { result_set?: ResultSet }).result_set;
        if (rs && rs.data.length > 1) t.blocks.push(tableBlock(data.tool_use_id as string, rs));
      }
      return t;
    }

    case "response.text.delta": {
      const index = data.content_index as number;
      const i = t.blocks.findIndex((b) => b.kind === "text" && b.index === index);
      if (i === -1) t.blocks.push({ kind: "text", index, text: data.text as string });
      else t.blocks[i] = { ...(t.blocks[i] as Extract<Block, { kind: "text" }>), text: (t.blocks[i] as Extract<Block, { kind: "text" }>).text + data.text };
      return t;
    }

    case "response.text": {
      const index = data.content_index as number;
      const i = t.blocks.findIndex((b) => b.kind === "text" && b.index === index);
      const block: Block = { kind: "text", index, text: data.text as string };
      if (i === -1) t.blocks.push(block);
      else t.blocks[i] = block;
      return t;
    }

    case "response.table": {
      const id = `table-${data.content_index}`;
      if (!t.blocks.some((b) => b.kind === "table" && (b.id === id || b.id === data.tool_use_id)))
        t.blocks.push(tableBlock(id, data.result_set as ResultSet, data.title as string | undefined));
      return t;
    }

    case "response.chart":
      t.blocks.push({ kind: "chart", id: `chart-${data.content_index}`, spec: data.chart_spec as string });
      return t;

    case "response":
      t.content = data.content as unknown[];
      t.status = "done";
      t.statusText = undefined;
      return t;

    case "error":
      t.status = "error";
      t.error = (data.message as string) ?? "Something went wrong";
      return t;

    default:
      return t;
  }
}

/** What the agent needs to continue the conversation: user text plus each finished assistant reply. */
export function toMessages(turns: Turn[]) {
  const messages: { role: "user" | "assistant"; content: unknown[] }[] = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.role === "user") {
      const reply = turns[i + 1];
      if (reply?.role === "assistant" && reply.status !== "done") {
        i++;
        continue;
      }
      messages.push({ role: "user", content: [{ type: "text", text: turn.text }] });
    } else if (turn.content) {
      messages.push({ role: "assistant", content: turn.content });
    }
  }
  return messages;
}

/** POSTs to /api/agent and calls onEvent for each server-sent event. */
export async function streamAgent(
  messages: ReturnType<typeof toMessages>,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  signal?: AbortSignal,
) {
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ? `${body.error}: ${body.detail}` : (body.error ?? `Request failed (${res.status})`));
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let split: number;
    while ((split = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const raw = buffer.slice(0, split);
      buffer = buffer.slice(split).replace(/^\r?\n\r?\n/, "");
      let event = "message";
      const data: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      try {
        onEvent(event, JSON.parse(data.join("\n")));
      } catch {
        // Ignore keep-alives and anything that isn't JSON.
      }
    }
  }
}

/** Splits a reply into its markdown and the quick replies in a trailing ```options block. */
export function splitOptions(text: string): { body: string; options: string[] } {
  const match = text.match(/```options\s*([\s\S]*?)```/);
  if (!match) return { body: text.split("```options")[0], options: [] };
  let options: string[] = [];
  try {
    options = JSON.parse(match[1]);
  } catch {
    options = [];
  }
  return { body: text.replace(match[0], "").trim(), options: Array.isArray(options) ? options.map(String) : [] };
}
