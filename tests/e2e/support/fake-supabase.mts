/**
 * TEST-ONLY stand-in for the slice of Supabase this app uses, so end-to-end checks can run
 * where the real Supabase stack (Docker images) is unavailable. NEVER used in production.
 *
 *  - Auth (GoTrue-compatible subset): /auth/v1/otp, /verify, /user, /logout, /token, JWKS.
 *    Issues ES256-signed JWTs that supabase-js verifies locally against the JWKS, exactly as
 *    with real Supabase. Test sign-in code is 000000 for any existing, confirmed Auth user.
 *  - REST (PostgREST-compatible subset): select/eq/neq/lt/lte/gt/gte/in/is, order, limit,
 *    single/maybeSingle, insert/update/delete with Prefer count, and /rpc/<fn>.
 *    Every request runs in a transaction AS the caller's role (anon/authenticated) with the
 *    JWT claims set, so the real RLS policies, grants and functions are what get exercised.
 *
 *   node tests/e2e/support/fake-supabase.mts --db <postgres url> --port 54399
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { generateKeyPairSync, randomUUID, createSign, createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const DB_URL = args.db ?? process.env.FAKE_SUPABASE_DB;
const PORT = Number(args.port ?? 54399);
const TEST_CODE = "000000";
if (!DB_URL) throw new Error("--db <postgres url> is required");
const pool = new pg.Pool({ connectionString: DB_URL, max: 10 });

// ---- signing key / JWT ------------------------------------------------------
// A STABLE test key (kept in test-results/), so restarting this server doesn't invalidate the key the
// app has already fetched and cached, just as a real Supabase project keeps its signing key.
const KEY_FILE = "test-results/fake-supabase-signing-key.pem";
if (!existsSync(KEY_FILE)) {
  mkdirSync("test-results", { recursive: true });
  const kp = generateKeyPairSync("ec", { namedCurve: "P-256" });
  writeFileSync(KEY_FILE, kp.privateKey.export({ type: "pkcs8", format: "pem" }));
}
const privateKey = createPrivateKey(readFileSync(KEY_FILE));
const publicKey = createPublicKey(privateKey);
const KID = "fake-supabase-key";
const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "ES256", use: "sig", key_ops: ["verify"] };
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function signJwt(payload: Record<string, unknown>) {
  const header = b64u(JSON.stringify({ alg: "ES256", typ: "JWT", kid: KID }));
  const body = b64u(JSON.stringify(payload));
  const sig = createSign("SHA256").update(`${header}.${body}`).sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${header}.${body}.${b64u(sig)}`;
}
function readJwt(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  try {
    const [, body] = token.split(".");
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof p.exp === "number" && p.exp * 1000 < Date.now()) return null;
    return p.role === "authenticated" ? p : null; // signature checked by the app via JWKS; this server trusts its own tokens
  } catch {
    return null;
  }
}

const refreshTokens = new Map<string, { id: string; email: string }>();
function session(user: { id: string; email: string }) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;
  const access_token = signJwt({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", iat: now, exp, session_id: randomUUID(), iss: `http://127.0.0.1:${PORT}/auth/v1` });
  const refresh_token = randomUUID();
  refreshTokens.set(refresh_token, user);
  const u = { id: user.id, aud: "authenticated", role: "authenticated", email: user.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString() };
  return { access_token, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token, user: u };
}

// ---- helpers ----------------------------------------------------------------
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString();
  return s ? JSON.parse(s) : {};
}
function send(res: ServerResponse, status: number, data?: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(data === undefined ? "" : JSON.stringify(data));
}
const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (s: string) => {
  if (!IDENT.test(s)) throw Object.assign(new Error(`bad identifier ${s}`), { http: 400 });
  return `"${s}"`;
};

async function asCaller<T>(req: IncomingMessage, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const token = (req.headers.authorization ?? "").replace(/^Bearer /i, "");
  const claims = readJwt(token);
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? { role: "anon" })]);
    await c.query(`set local role ${claims ? "authenticated" : "anon"}`);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

function pgError(res: ServerResponse, e: unknown, authed: boolean) {
  const err = e as { code?: string; message?: string; detail?: string; hint?: string; http?: number };
  const status = err.http ?? (err.code === "42501" ? (authed ? 403 : 401) : err.code === "P0001" ? 400 : err.code?.startsWith("23") ? 409 : 400);
  send(res, status, { code: err.code ?? "PGRST000", message: err.message ?? "error", details: err.detail ?? null, hint: err.hint ?? null });
}

function parseFilters(sp: URLSearchParams, params: unknown[]) {
  const where: string[] = [];
  for (const [k, raw] of sp) {
    if (["select", "order", "limit", "offset", "columns", "on_conflict"].includes(k)) continue;
    const col = ident(k);
    const dot = raw.indexOf(".");
    const op = raw.slice(0, dot);
    const val = raw.slice(dot + 1);
    const ops: Record<string, string> = { eq: "=", neq: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=" };
    if (op in ops) { params.push(val); where.push(`${col} ${ops[op]} $${params.length}`); }
    else if (op === "in") {
      const items = val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")).filter(Boolean);
      params.push(items); where.push(`${col}::text = any($${params.length}::text[])`);
    } else if (op === "is") where.push(`${col} is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`);
    else throw Object.assign(new Error(`unsupported filter ${op}`), { http: 400 });
  }
  return where.length ? ` where ${where.join(" and ")}` : "";
}

// ---- server -------------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const authed = Boolean(readJwt((req.headers.authorization ?? "").replace(/^Bearer /i, "")));
  try {
    // ---------------- auth ----------------
    if (path === "/auth/v1/.well-known/jwks.json") return send(res, 200, { keys: [jwk] });
    if (path === "/auth/v1/otp" && req.method === "POST") { await body(req); return send(res, 200, {}); }
    if (path === "/auth/v1/verify" && req.method === "POST") {
      const b = (await body(req)) as { email?: string; token?: string };
      const r = await pool.query("select id, email from auth.users where lower(email) = lower($1) and email_confirmed_at is not null", [b.email ?? ""]);
      if (!r.rows[0] || b.token !== TEST_CODE) return send(res, 403, { code: "otp_expired", error_code: "otp_expired", msg: "Token has expired or is invalid" });
      return send(res, 200, session(r.rows[0]));
    }
    if (path === "/auth/v1/token" && req.method === "POST") {
      const b = (await body(req)) as { refresh_token?: string };
      const u = b.refresh_token ? refreshTokens.get(b.refresh_token) : undefined;
      if (!u) return send(res, 400, { code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      return send(res, 200, session(u));
    }
    if (path === "/auth/v1/user") {
      const c = readJwt((req.headers.authorization ?? "").replace(/^Bearer /i, ""));
      return c ? send(res, 200, { id: c.sub, email: c.email, aud: "authenticated", role: "authenticated" }) : send(res, 401, { msg: "invalid JWT" });
    }
    if (path === "/auth/v1/logout") return send(res, 204);
    if (path === "/auth/v1/invite" && req.method === "POST") {
      // Admin API: only the (test) secret key may call it. Simulates the invitee accepting at once.
      if ((req.headers.authorization ?? "") !== `Bearer ${process.env.FAKE_SECRET_KEY ?? "sb_secret_test"}`) return send(res, 401, { msg: "invalid key" });
      const b = (await body(req)) as { email?: string };
      const exists = await pool.query("select 1 from auth.users where lower(email) = lower($1)", [b.email ?? ""]);
      if (exists.rowCount) return send(res, 422, { code: "email_exists", msg: "A user with this email address has already been registered" });
      const r = await pool.query("insert into auth.users (email, email_confirmed_at) values (lower($1), now()) returning id, email", [b.email]);
      return send(res, 200, { id: r.rows[0].id, email: r.rows[0].email, aud: "authenticated", role: "authenticated" });
    }

    // ---------------- rpc ----------------
    const rpc = path.match(/^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/);
    if (rpc) {
      const args = ((await body(req)) ?? {}) as Record<string, unknown>;
      const meta = await pool.query(
        `select proretset, prorettype::regtype::text as rettype, proargnames, array(select format_type(t, null) from unnest(proargtypes) t) as argtypes
         from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [rpc[1]]);
      if (!meta.rows[0]) return send(res, 404, { code: "PGRST202", message: "function not found" });
      const m = meta.rows[0];
      const names: string[] = m.proargnames ?? [];
      const params: unknown[] = [];
      const parts = Object.entries(args).map(([k, v]) => {
        const i = names.indexOf(k);
        if (i < 0) throw Object.assign(new Error(`unknown argument ${k}`), { http: 400 });
        params.push(v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v);
        return `${ident(k)} => $${params.length}::${m.argtypes[i]}`;
      });
      const call = `public.${ident(rpc[1])}(${parts.join(", ")})`;
      const data = await asCaller(req, async (c) => {
        if (m.proretset) return (await c.query(`select * from ${call}`, params)).rows;
        return (await c.query(`select ${call} as r`, params)).rows[0].r;
      });
      return send(res, 200, data);
    }

    // ---------------- tables ----------------
    const tbl = path.match(/^\/rest\/v1\/([a-z_][a-z0-9_]*)$/);
    if (tbl) {
      const table = `public.${ident(tbl[1])}`;
      const prefer = String(req.headers.prefer ?? "");
      const wantCount = /count=exact/.test(prefer);
      const wantRows = /return=representation/.test(prefer) || req.method === "GET";
      const single = String(req.headers.accept ?? "").includes("vnd.pgrst.object");
      const params: unknown[] = [];
      const where = parseFilters(url.searchParams, params);
      const sel = (url.searchParams.get("select") ?? "*").split(",").map((c) => (c.trim() === "*" ? "*" : ident(c.trim()))).join(", ");

      const result = await asCaller(req, async (c) => {
        if (req.method === "GET" || req.method === "HEAD") {
          let sql = `select ${sel} from ${table}${where}`;
          const order = url.searchParams.get("order");
          if (order) sql += " order by " + order.split(",").map((o) => { const [col, dir] = o.split("."); return `${ident(col)} ${dir === "desc" ? "desc" : "asc"}`; }).join(", ");
          const limit = url.searchParams.get("limit");
          if (limit) sql += ` limit ${Number(limit)}`;
          return (await c.query(sql, params)).rows;
        }
        if (req.method === "POST") {
          const b = await body(req);
          const list = (Array.isArray(b) ? b : [b]) as Record<string, unknown>[];
          const out: unknown[] = [];
          for (const row of list) {
            const cols = Object.keys(row);
            const vals = cols.map((k) => row[k]);
            const r = await c.query(`insert into ${table} (${cols.map(ident).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})${wantRows ? " returning *" : ""}`, vals);
            out.push(...r.rows);
            if (!wantRows) out.push(null);
          }
          return out;
        }
        if (req.method === "PATCH") {
          const b = (await body(req)) as Record<string, unknown>;
          const cols = Object.keys(b);
          const p2 = [...params, ...cols.map((k) => b[k])];
          const set = cols.map((k, i) => `${ident(k)} = $${params.length + i + 1}`).join(", ");
          const r = await c.query(`update ${table} set ${set}${where} returning *`, p2);
          return r.rows;
        }
        if (req.method === "DELETE") return (await c.query(`delete from ${table}${where} returning *`, params)).rows;
        throw Object.assign(new Error("method not allowed"), { http: 405 });
      });

      const headers: Record<string, string> = {};
      if (wantCount) headers["content-range"] = `0-${Math.max(0, result.length - 1)}/${result.length}`;
      if (req.method === "GET" && single) {
        if (result.length !== 1) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${result.length} rows` });
        return send(res, 200, result[0], headers);
      }
      if (req.method !== "GET" && !wantRows) return send(res, wantCount ? 204 : 201, undefined, headers);
      return send(res, 200, result, headers);
    }
    send(res, 404, { message: `not implemented in fake: ${req.method} ${path}` });
  } catch (e) {
    pgError(res, e, authed);
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`fake-supabase listening on http://127.0.0.1:${PORT}`));
