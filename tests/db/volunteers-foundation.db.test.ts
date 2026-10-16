import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthUser, createTestDb, createVolunteer, rows, type TestDb } from "./harness";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const link = (uid: string) =>
  db.asUserCommit(uid, async (c) => (await rows<{ r: string }>(c, "select public.link_volunteer_account() as r"))[0].r);

describe("account linking (invite-only)", () => {
  it("links an invited, active volunteer by verified email (case-insensitive)", async () => {
    const vid = await createVolunteer(db, { email: "Sam.Keeper@Example.org" });
    const uid = await createAuthUser(db, "sam.keeper@example.org");
    expect(await link(uid)).toBe("linked");
    const [row] = await rows<{ auth_user_id: string; linked_at: Date | null }>(
      db.admin,
      "select auth_user_id, linked_at from public.volunteers where id = $1",
      [vid],
    );
    expect(row.auth_user_id).toBe(uid);
    expect(row.linked_at).not.toBeNull();
    expect(await link(uid)).toBe("already_linked");
  });

  it("refuses an Auth user with no volunteer row (uninvited)", async () => {
    const uid = await createAuthUser(db, "stranger@example.org");
    expect(await link(uid)).toBe("not_invited");
  });

  it("refuses a volunteer row that was never invited", async () => {
    await createVolunteer(db, { email: "notyet@example.org", invited: false });
    const uid = await createAuthUser(db, "notyet@example.org");
    expect(await link(uid)).toBe("not_invited");
  });

  it("refuses a suspended (inactive) volunteer and does not link", async () => {
    const vid = await createVolunteer(db, { email: "suspended@example.org", isActive: false });
    const uid = await createAuthUser(db, "suspended@example.org");
    expect(await link(uid)).toBe("inactive");
    const [row] = await rows<{ auth_user_id: string | null }>(
      db.admin,
      "select auth_user_id from public.volunteers where id = $1",
      [vid],
    );
    expect(row.auth_user_id).toBeNull();
  });

  it("refuses an unverified email", async () => {
    await createVolunteer(db, { email: "unverified@example.org" });
    const uid = await createAuthUser(db, "unverified@example.org", { confirmed: false });
    expect(await link(uid)).toBe("unverified");
  });

  it("never re-points a row already linked to a different Auth user", async () => {
    const owner = await createAuthUser(db, "owned@example.org");
    await createVolunteer(db, { email: "owned@example.org", authUserId: owner });
    // A second Auth identity claiming the same address must not take the row over.
    await db.admin.query("update auth.users set email = 'owned-old@example.org' where id = $1", [owner]);
    const intruder = await createAuthUser(db, "owned@example.org");
    expect(await link(intruder)).toBe("conflict");
  });

  it("anon cannot call the linking function", async () => {
    await expect(db.asAnon((c) => c.query("select public.link_volunteer_account()"))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("takes no client-supplied volunteer id", async () => {
    const [fn] = await rows<{ args: string }>(
      db.admin,
      "select pg_get_function_identity_arguments('public.link_volunteer_account'::regproc) as args",
    );
    expect(fn.args).toBe("");
  });
});

describe("row level security on volunteers", () => {
  let aliceUid: string;
  let aliceId: string;
  let bobId: string;
  let adminUid: string;
  let suspendedUid: string;

  beforeAll(async () => {
    aliceUid = await createAuthUser(db, "alice@example.org");
    aliceId = await createVolunteer(db, { email: "alice@example.org", authUserId: aliceUid, displayName: "Alice" });
    const bobUid = await createAuthUser(db, "bob@example.org");
    bobId = await createVolunteer(db, { email: "bob@example.org", authUserId: bobUid, displayName: "Bob" });
    adminUid = await createAuthUser(db, "admin@example.org");
    await createVolunteer(db, { email: "admin@example.org", authUserId: adminUid, role: "admin" });
    suspendedUid = await createAuthUser(db, "gone@example.org");
    await createVolunteer(db, { email: "gone@example.org", authUserId: suspendedUid, isActive: false });
  });

  it("anon reads nothing", async () => {
    await expect(db.asAnon((c) => c.query("select * from public.volunteers"))).rejects.toThrow(/permission denied/);
  });

  it("a volunteer sees only their own row (no other emails or phones)", async () => {
    const seen = await db.asUser(aliceUid, (c) => rows<{ id: string }>(c, "select id from public.volunteers"));
    expect(seen.map((r) => r.id)).toEqual([aliceId]);
    const bob = await db.asUser(aliceUid, (c) =>
      rows(c, "select email, phone from public.volunteers where id = $1", [bobId]),
    );
    expect(bob).toHaveLength(0);
  });

  it("an admin sees all rows", async () => {
    const seen = await db.asUser(adminUid, (c) => rows(c, "select id from public.volunteers"));
    expect(seen.length).toBeGreaterThanOrEqual(4);
  });

  it("a suspended volunteer cannot read even their own row, and has no role", async () => {
    const seen = await db.asUser(suspendedUid, (c) => rows(c, "select id from public.volunteers"));
    expect(seen).toHaveLength(0);
    const [r] = await db.asUser(suspendedUid, (c) =>
      rows<{ role: string | null; vid: string | null }>(
        c,
        "select public.current_app_role() as role, public.current_volunteer_id() as vid",
      ),
    );
    expect(r).toEqual({ role: null, vid: null });
  });

  it("a volunteer can edit their own display name and phone", async () => {
    const updated = await db.asUser(aliceUid, async (c) => {
      await c.query("update public.volunteers set display_name = 'Alice W', phone = '07700 900000' where id = $1", [aliceId]);
      return rows<{ display_name: string }>(c, "select display_name from public.volunteers where id = $1", [aliceId]);
    });
    expect(updated[0].display_name).toBe("Alice W");
  });

  it.each([
    ["role", "update public.volunteers set role = 'admin' where id = $1"],
    ["is_active", "update public.volunteers set is_active = true where id = $1"],
    ["email", "update public.volunteers set email = 'x@example.org' where id = $1"],
    ["auth_user_id", "update public.volunteers set auth_user_id = null where id = $1"],
  ])("a volunteer cannot change their own %s", async (_col, sql) => {
    await expect(db.asUser(aliceUid, (c) => c.query(sql, [aliceId]))).rejects.toThrow(/permission denied/);
  });

  it("a volunteer cannot edit someone else's profile (no rows affected)", async () => {
    const n = await db.asUser(aliceUid, async (c) =>
      (await c.query("update public.volunteers set display_name = 'Hacked' where id = $1", [bobId])).rowCount,
    );
    expect(n).toBe(0);
  });

  it("a volunteer cannot insert or delete volunteers", async () => {
    await expect(
      db.asUser(aliceUid, (c) =>
        c.query("insert into public.volunteers (email, display_name) values ('new@example.org', 'New')"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(db.asUser(aliceUid, (c) => c.query("delete from public.volunteers where id = $1", [bobId]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("current_app_role reflects an active admin", async () => {
    const [r] = await db.asUser(adminUid, (c) => rows<{ role: string }>(c, "select public.current_app_role() as role"));
    expect(r.role).toBe("admin");
  });
});
