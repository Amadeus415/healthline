import "server-only";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

// Talks to Snowflake as the HEALTHLINE_APP service user with key-pair auth.
// Credentials never leave the server: the browser only sees our /api routes.

const account = required("SNOWFLAKE_ACCOUNT").toUpperCase();
const user = required("SNOWFLAKE_USER").toUpperCase();
const role = process.env.SNOWFLAKE_ROLE ?? "HEALTHLINE_APP_ROLE";
const warehouse = process.env.SNOWFLAKE_WAREHOUSE ?? "HEALTHLINE_WH";
const agentPath = (process.env.SNOWFLAKE_AGENT ?? "HEALTHLINE.GOLD.ER_ASSISTANT").split(".");
const host =
  process.env.SNOWFLAKE_HOST ?? `https://${account.toLowerCase().replace(/_/g, "-")}.snowflakecomputing.com`;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Copy web/.env.example to web/.env.local.`);
  return value;
}

function privateKey() {
  const pem = process.env.SNOWFLAKE_PRIVATE_KEY ?? readFileSync(required("SNOWFLAKE_PRIVATE_KEY_PATH"), "utf8");
  return createPrivateKey(pem.replace(/\\n/g, "\n"));
}

let cached: { token: string; expires: number } | null = null;

function token() {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expires - 60 > now) return cached.token;

  const key = privateKey();
  const der = createPublicKey(key).export({ type: "spki", format: "der" });
  const fingerprint = createHash("sha256").update(der).digest("base64");
  const qualified = `${account}.${user}`;
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: `${qualified}.SHA256:${fingerprint}`,
    sub: qualified,
    iat: now,
    exp: now + 3540,
  })}`;
  const signature = sign("RSA-SHA256", Buffer.from(body), key).toString("base64url");
  cached = { token: `${body}.${signature}`, expires: now + 3540 };
  return cached.token;
}

function headers(accept: string) {
  return {
    Authorization: `Bearer ${token()}`,
    "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
    "X-Snowflake-Role": role,
    "Content-Type": "application/json",
    Accept: accept,
  };
}

export type AgentMessage = { role: "user" | "assistant"; content: unknown[] };

/** Runs the Cortex Agent and returns its server-sent event stream untouched. */
export function runAgent(messages: AgentMessage[], signal?: AbortSignal) {
  const [db, schema, name] = agentPath;
  return fetch(`${host}/api/v2/databases/${db}/schemas/${schema}/agents/${name}:run`, {
    method: "POST",
    headers: headers("text/event-stream"),
    body: JSON.stringify({ messages, stream: true }),
    signal,
  });
}

type Binding = string | number | null;

/** Runs one statement through the SQL API and returns rows as objects keyed by lowercase column. */
export async function sql<T = Record<string, unknown>>(statement: string, binds: Binding[] = []): Promise<T[]> {
  const bindings = Object.fromEntries(
    binds.map((v, i) => [String(i + 1), { type: typeof v === "number" ? "FIXED" : "TEXT", value: v === null ? null : String(v) }]),
  );
  const res = await fetch(`${host}/api/v2/statements`, {
    method: "POST",
    headers: headers("application/json"),
    body: JSON.stringify({ statement, warehouse, role, timeout: 60, bindings }),
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message ?? `Snowflake returned ${res.status}`);
  const cols: { name: string; type: string }[] = json.resultSetMetaData.rowType;
  return (json.data as (string | null)[][]).map((row) =>
    Object.fromEntries(
      row.map((v, i) => {
        const { name, type } = cols[i];
        const parsed =
          v === null ? null : type === "fixed" || type === "real" ? Number(v) : type === "boolean" ? v === "true" : type === "variant" || type === "object" || type === "array" ? JSON.parse(v) : v;
        return [name.toLowerCase(), parsed];
      }),
    ) as T,
  );
}
