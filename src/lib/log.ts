/**
 * Production logging that never carries personal details or secrets.
 * Values are scrubbed of email addresses, phone-like numbers, bearer tokens and API keys, and
 * any field whose name suggests personal data is dropped entirely. Use counts, codes and ids.
 */
type Fields = Record<string, unknown>;

const DROP_KEYS = /^(email|e-?mail|to|from|phone|mobile|name|display_?name|recipient.*|address|token|secret|password|key|api_?key|authorization|cookie|html|text|body|reason)$/i;

export function redact(value: string): string {
  return value
    .replace(/[^\s@<>"',;]+@[^\s@<>"',;]+/g, "[email]")
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(sb_secret_|sb_publishable_|re_|sk_|pk_)[A-Za-z0-9_-]{4,}/g, "[key]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
    .replace(/\+?\d[\d\s-]{8,}\d/g, "[number]");
}

function clean(fields: Fields, depth = 0): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (DROP_KEYS.test(k)) continue;
    if (typeof v === "string") out[k] = redact(v).slice(0, 300);
    else if (typeof v === "number" || typeof v === "boolean" || v == null) out[k] = v;
    else if (v instanceof Error) out[k] = redact(v.name);
    else if (typeof v === "object" && depth < 2 && !Array.isArray(v)) out[k] = clean(v as Fields, depth + 1);
    else if (Array.isArray(v)) out[k] = `[${v.length} items]`;
  }
  return out;
}

function emit(level: "info" | "warn" | "error", scope: string, message: string, fields: Fields = {}) {
  const line = JSON.stringify({ level, scope, message: redact(message), ...clean(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const log = {
  info: (scope: string, message: string, fields?: Fields) => emit("info", scope, message, fields),
  warn: (scope: string, message: string, fields?: Fields) => emit("warn", scope, message, fields),
  error: (scope: string, message: string, fields?: Fields) => emit("error", scope, message, fields),
};
