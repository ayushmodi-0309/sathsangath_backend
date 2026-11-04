import os from "os";
import { config } from "./config";

/**
 * Forwards every application and system log to PostHog Logs, and still prints
 * locally so Vercel (and a local terminal) keep the same stream.
 *
 * The network send is queued and flushed off the request path. On Vercel the
 * flush is handed to the request's waitUntil hook so the response is not held
 * open and the send is not frozen when the invocation ends.
 *
 * With no POSTHOG_API_KEY the queue, console patch, and process hooks are
 * never installed. logger.* still prints locally.
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const SEVERITY: Record<LogLevel, { text: string; number: number }> = {
  trace: { text: "TRACE", number: 1 },
  debug: { text: "DEBUG", number: 5 },
  info: { text: "INFO", number: 9 },
  warn: { text: "WARN", number: 13 },
  error: { text: "ERROR", number: 17 },
};

const SECRET_ENV_KEYS = [
  "POSTHOG_API_KEY",
  "JWT_SECRET",
  "DATABASE_URL",
  "DIRECT_URL",
  "SMTP_PASS",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_ACCOUNT_SID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCESS_KEY",
  "CLOUDFLARE_SECRET_KEY",
  "STORAGE_ACCESS_KEY",
  "STORAGE_SECRET_KEY",
  "FIREBASE_SERVICE_ACCOUNT",
  "INTAKE_WEBHOOK_SECRET",
  "SEED_ADMIN_PASSWORD",
] as const;

const MAX_BODY = 8_000;
const MAX_ATTR = 2_000;
const QUEUE_MAX = 300;
const BATCH = 40;
const FLUSH_DELAY_MS = 400;
const FAILURE_BACKOFF_MS = 10_000;

const local = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
  trace: console.trace.bind(console),
};

const host = resolveHost(config.posthog.host);
const enabled = config.posthog.apiKey.length > 0 && host !== null;
const endpoint = enabled ? `${host}/i/v1/logs?token=${encodeURIComponent(config.posthog.apiKey)}` : "";
const secrets = enabled ? collectSecrets() : [];
const resourceAttributes = enabled ? buildResourceAttributes() : [];

type OtlpValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number };

interface LogRecord {
  timeUnixNano: string;
  observedTimeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: { key: string; value: OtlpValue }[];
}

let installed = false;
let shipping = false;
let queue: LogRecord[] = [];
let timer: NodeJS.Timeout | null = null;
let flushing = false;
let scheduled: Promise<void> | null = null;
let releaseScheduled: (() => void) | null = null;
let backoffUntil = 0;
let failureNotedAt = 0;
let dropNotedAt = 0;

function resolveHost(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function collectSecrets(): string[] {
  const found = new Set<string>();
  for (const key of SECRET_ENV_KEYS) {
    const value = process.env[key];
    if (value && value.length >= 12) found.add(value);
  }
  for (const key of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const raw = process.env[key];
    if (!raw) continue;
    try {
      const password = decodeURIComponent(new URL(raw).password);
      if (password.length >= 8) found.add(password);
    } catch { /* not a URL */ }
  }
  return [...found].sort((a, b) => b.length - a.length);
}

function buildResourceAttributes(): { key: string; value: OtlpValue }[] {
  const attrs: Record<string, string> = {
    "service.name": "sathsangath-api",
    "service.version": process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "1.0.0",
    "deployment.environment": process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    "telemetry.sdk.name": "sathsangath-logger",
    "telemetry.sdk.version": "1.0.0",
    "os.name": os.type(),
    "os.version": os.release(),
  };
  if (process.env.VERCEL_REGION) attrs["cloud.region"] = process.env.VERCEL_REGION;
  return Object.entries(attrs).map(([key, value]) => ({ key, value: { stringValue: value } }));
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[truncated]`;
}

function safeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_key, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
      }
      return v;
    }) ?? String(value);
  } catch {
    return String(value);
  }
}

function redact(text: string): string {
  let out = text;
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join("[redacted]");
  }
  out = out.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted]");
  out = out.replace(/\b(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, "$1[redacted]");
  out = out.replace(/(^|[\s?&])((?:token|password|secret|api_key|apikey|access_token)=)[^&\s]*/gi, "$1$2[redacted]");
  return out;
}

function toValue(value: unknown): OtlpValue {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: clip(redact(safeString(value)), MAX_ATTR) };
}

function attributes(source: string, fields?: LogFields): { key: string; value: OtlpValue }[] {
  const list: { key: string; value: OtlpValue }[] = [{ key: "source", value: { stringValue: source } }];
  if (!fields) return list;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || key === "source") continue;
    list.push({ key: clip(key, 80), value: toValue(value) });
  }
  return list;
}

function unixNano(): string {
  return `${Date.now()}000000`;
}

/** Same hook @vercel/functions uses. Absent outside a Vercel request, so this is a no-op locally. */
function hold(promise: Promise<void>) {
  if (!process.env.VERCEL) return;
  try {
    const carrier = globalThis as typeof globalThis & {
      [key: symbol]: { get?: () => { waitUntil?: (p: Promise<unknown>) => void } } | undefined;
    };
    carrier[Symbol.for("@vercel/request-context")]?.get?.()?.waitUntil?.(promise);
  } catch { /* startup or local process: the timer still flushes */ }
}

function noteFailure() {
  const now = Date.now();
  if (now - failureNotedAt < 60_000) return;
  failureNotedAt = now;
  local.error("[logger] PostHog log delivery failed; further logs stay on the host until the next attempt");
}

function noteDrop(count: number) {
  const now = Date.now();
  if (now - dropNotedAt < 60_000) return;
  dropNotedAt = now;
  local.warn(`[logger] dropped ${count} PostHog log(s); queue full`);
}

function kick() {
  if (!scheduled) {
    scheduled = new Promise<void>((resolve) => { releaseScheduled = resolve; });
  }
  hold(scheduled);
  const dueNow = queue.length >= BATCH;
  if (dueNow && timer) { clearTimeout(timer); timer = null; }
  if (timer || flushing) return;
  const delay = Math.max(dueNow ? 0 : FLUSH_DELAY_MS, backoffUntil - Date.now(), 0);
  timer = setTimeout(runFlush, delay);
  timer.unref();
}

function runFlush() {
  timer = null;
  if (flushing) return;
  flushing = true;
  void drain().finally(() => {
    flushing = false;
    const release = releaseScheduled;
    releaseScheduled = null;
    scheduled = null;
    release?.();
    if (queue.length) kick();
  });
}

async function drain(): Promise<void> {
  while (queue.length) {
    if (Date.now() < backoffUntil) return;
    const batch = queue.splice(0, BATCH);
    const ok = await postBatch(batch);
    if (!ok) {
      noteFailure();
      backoffUntil = Date.now() + FAILURE_BACKOFF_MS;
      return;
    }
  }
}

async function postBatch(records: LogRecord[]): Promise<boolean> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.posthog.apiKey}`,
      },
      body: JSON.stringify({
        resourceLogs: [{
          resource: { attributes: resourceAttributes },
          scopeLogs: [{ scope: { name: "sathsangath-api", version: "1.0.0" }, logRecords: records }],
        }],
      }),
      signal: AbortSignal.timeout(4_000),
    });
    await res.arrayBuffer().catch(() => undefined);
    return res.ok;
  } catch {
    return false;
  }
}

function enqueue(level: LogLevel, body: string, source: string, fields?: LogFields) {
  if (!enabled || shipping) return;
  const text = clip(redact(body).trim(), MAX_BODY);
  if (!text) return;
  shipping = true;
  try {
    const now = unixNano();
    const severity = SEVERITY[level];
    queue.push({
      timeUnixNano: now,
      observedTimeUnixNano: now,
      severityNumber: severity.number,
      severityText: severity.text,
      body: { stringValue: text },
      attributes: attributes(source, fields),
    });
    if (queue.length > QUEUE_MAX) {
      const dropped = queue.length - QUEUE_MAX;
      queue.splice(0, dropped);
      noteDrop(dropped);
    }
    kick();
  } finally {
    shipping = false;
  }
}

function writeLocal(level: LogLevel, message: string, fields?: LogFields) {
  const fn = level === "error" ? local.error
    : level === "warn" ? local.warn
    : level === "debug" || level === "trace" ? local.debug
    : local.log;
  if (fields && Object.keys(fields).length) fn(message, fields);
  else fn(message);
}

function withoutSource(fields?: LogFields): LogFields | undefined {
  if (!fields) return undefined;
  const rest: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === "source" || value === undefined) continue;
    rest[key] = value;
  }
  return Object.keys(rest).length ? rest : undefined;
}

function emit(level: LogLevel, message: unknown, fields?: LogFields, source = "app") {
  const text = safeString(message);
  const printed = withoutSource(fields);
  if (!text.trim() && !printed) return;
  writeLocal(level, text, printed);
  const explicitSource = fields?.source === undefined ? source : String(fields.source);
  enqueue(level, text.trim() ? text : safeString(printed), explicitSource, fields);
}

function fromConsole(level: LogLevel, args: unknown[]) {
  enqueue(level, args.map(safeString).join(" "), "console");
}

function patchConsole() {
  console.log = (...args: unknown[]) => { local.log(...args); fromConsole("info", args); };
  console.info = (...args: unknown[]) => { local.info(...args); fromConsole("info", args); };
  console.warn = (...args: unknown[]) => { local.warn(...args); fromConsole("warn", args); };
  console.error = (...args: unknown[]) => { local.error(...args); fromConsole("error", args); };
  console.debug = (...args: unknown[]) => { local.debug(...args); fromConsole("debug", args); };
  console.trace = (...args: unknown[]) => { local.trace(...args); fromConsole("trace", args); };
}

function hookProcess() {
  process.on("uncaughtExceptionMonitor", (err) => enqueue("error", safeString(err), "uncaughtException"));
  process.on("unhandledRejection", (reason) => enqueue("error", safeString(reason), "unhandledRejection"));
  process.on("warning", (warning) => enqueue("warn", safeString(warning), "process"));
  process.once("beforeExit", () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (queue.length) runFlush();
    if (scheduled) {
      const keepAlive = setTimeout(() => {}, 5_000);
      void scheduled.finally(() => clearTimeout(keepAlive));
    }
  });
}

/** Patches console and process hooks. No-op when POSTHOG_API_KEY is missing or the host is not https. */
export function installLogger(): void {
  if (installed) return;
  installed = true;
  if (!config.posthog.apiKey) return;
  if (!host) {
    local.warn("[logger] POSTHOG_HOST must be an https URL; PostHog logging is off");
    return;
  }
  patchConsole();
  hookProcess();
}

export const logger = {
  /** True only when the PostHog shipper was initialized. */
  get enabled() { return enabled; },
  trace(message: unknown, fields?: LogFields) { emit("trace", message, fields); },
  debug(message: unknown, fields?: LogFields) { emit("debug", message, fields); },
  info(message: unknown, fields?: LogFields) { emit("info", message, fields); },
  warn(message: unknown, fields?: LogFields) { emit("warn", message, fields); },
  error(message: unknown, fields?: LogFields) { emit("error", message, fields); },
};

// Importing this module is the install point. app.ts imports it before the routers,
// so logs emitted while the rest of the server loads are included.
installLogger();
