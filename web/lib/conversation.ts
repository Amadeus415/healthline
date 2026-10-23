import type { PersonaId } from "./personas";
import type { Chart, IdentifyResult } from "./types";

// The conversation model: agent SSE events are folded into turns the UI renders.

export type Step = { id: string; tool: string; label: string; status: "run" | "done" | "error"; startedAt: number; ms?: number };

export type Block =
  | { kind: "text"; index: number; text: string }
  | { kind: "identify"; id: string; data: IdentifyResult }
  | { kind: "table"; id: string; title?: string; columns: string[]; rows: (string | null)[][] }
  | { kind: "chart"; id: string; spec: string };

/** `sent` is what the agent sees when it differs from what the user typed (team tags, protocol). */
export type UserTurn = { id: string; role: "user"; text: string; sent?: string; persona?: PersonaId };

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
  replyTo?: PersonaId;
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
      messages.push({ role: "user", content: [{ type: "text", text: turn.sent ?? turn.text }] });
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

export type Handoff = { to: PersonaId; priority: "critical" | "high" | "routine"; title: string; summary: string };
export type TaskList = { to: PersonaId; items: { task: string; why?: string }[] };
export type Catch = { kind: "safety" | "time" | "cost" | "research"; text: string };

export type Directives = { body: string; options: string[]; handoffs: Handoff[]; tasks: TaskList[]; catches: Catch[] };

const DIRECTIVE = /```(options|handoff|tasks|catches)\s*([\s\S]*?)```/g;
const PERSONA_IDS = ["paramedic", "doctor", "nurse"];
const CATCH_KINDS = ["safety", "time", "cost", "research"];

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw.trim());
  } catch {
    return undefined;
  }
}

const list = (v: unknown) => (Array.isArray(v) ? v : v && typeof v === "object" ? [v] : []);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Pulls the fenced coordination blocks (options, handoff, tasks, catches) out of a reply. Malformed blocks are dropped. */
export function parseDirectives(text: string): Directives {
  const out: Directives = { body: "", options: [], handoffs: [], tasks: [], catches: [] };
  out.body = text
    .replace(DIRECTIVE, (_, kind: string, raw: string) => {
      const value = parseJson(raw);
      if (kind === "options") out.options.push(...list(value).map(String));
      if (kind === "handoff")
        for (const h of list(value) as Record<string, unknown>[]) {
          const to = str(h.to).toLowerCase();
          if (!PERSONA_IDS.includes(to) || !str(h.title)) continue;
          const priority = ["critical", "high", "routine"].includes(str(h.priority)) ? str(h.priority) : "high";
          out.handoffs.push({ to: to as PersonaId, priority: priority as Handoff["priority"], title: str(h.title), summary: str(h.summary) });
        }
      if (kind === "tasks")
        for (const t of list(value) as Record<string, unknown>[]) {
          const to = str(t.to).toLowerCase() || "nurse";
          const items = list(t.items)
            .map((i) => (typeof i === "string" ? { task: i } : { task: str((i as Record<string, unknown>).task), why: str((i as Record<string, unknown>).why) || undefined }))
            .filter((i) => i.task);
          if (PERSONA_IDS.includes(to) && items.length) out.tasks.push({ to: to as PersonaId, items });
        }
      if (kind === "catches")
        for (const c of list(value) as Record<string, unknown>[]) {
          const kind = str(c.kind).toLowerCase();
          if (str(c.text)) out.catches.push({ kind: (CATCH_KINDS.includes(kind) ? kind : "safety") as Catch["kind"], text: str(c.text) });
        }
      return "";
    })
    // While streaming, hide a block that has opened but not closed yet.
    .replace(/```(options|handoff|tasks|catches)[\s\S]*$/, "")
    .trim();
  return out;
}

/** Splits a reply into its markdown and the quick replies in a trailing ```options block. */
export function splitOptions(text: string): { body: string; options: string[] } {
  const { body, options } = parseDirectives(text);
  return { body, options };
}

/** Every directive in a finished or streaming assistant turn, across its text blocks. */
export function turnDirectives(turn: AssistantTurn): Directives {
  const text = turn.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("\n\n");
  return parseDirectives(text);
}
