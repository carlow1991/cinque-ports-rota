import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import { expectCode } from "./fixtures";
import { call, callCommit, hubUser, plainPerson, type HubUser } from "./hub-fixtures";

/** Stage 6 — public applications (secret-key endpoint only), duplicates, suggestions, review. */
let db: TestDb;
let admin: HubUser, coord: HubUser, member: HubUser;
let secretary: string, welfare: string, groundsman: string;

const good = (over: Record<string, unknown> = {}) => ({
  full_name: "Applicant (demo)", email: "Applicant@Example.org", phone: "", contact_preference: "email", is_adult: true,
  existing_club_connection: "parent_carer", heard_from: "website", interests: ["refreshments", "secretary", "bogus_code"], unsure_role: true,
  strengths: ["organisation", "administration", "hacker"], experience_text: "Ran a school PTA.", willing_to_learn: "yes",
  availability: [{ day: 5, daypart: "morning" }, { day: 5, daypart: "morning" }, { day: 9, daypart: "noon" }],
  commitment_bucket: "2to4", commitment_pattern: "regular", work_location_preference: "either", free_notes: "",
  privacy_acknowledged: true, privacy_notice_version: "draft-2026-10-19", communication_opt_in: false, ...over,
});
let keyN = 0;
const submit = (p: Record<string, unknown>, key = `rate-key-${++keyN}-abcdefghijklmnop`) =>
  db.asService(async (c) => (await c.query("select public.public_submit_application($1::jsonb, $2) r", [JSON.stringify(p), key])).rows[0].r);

beforeAll(async () => {
  db = await createTestDb();
  admin = await hubUser(db, "admin");
  coord = await hubUser(db, "coordinator");
  member = await hubUser(db, "member");
  await callCommit(db, admin, "select public.hub_add_suggested_positions()");
  const ids = Object.fromEntries((await rows<{ id: string; title: string }>(db.admin, "select id, title from club_positions")).map((r) => [r.title, r.id]));
  secretary = ids["Club Secretary"]; welfare = ids["Welfare Officer"]; groundsman = ids["Groundsman"];
  await db.admin.query("update club_positions set public_visible = true, seeking_replacement = true where id in ($1, $2)", [secretary, welfare]);
  await db.admin.query("update club_positions set skills_desirable = '{administration,organisation}' where id = $1", [secretary]);
});
afterAll(async () => db?.drop());

describe("C36 / C37 — a complete anonymous application", () => {
  let appId: string;
  it("is accepted and returns nothing but an acknowledgement", async () => {
    const r = await submit(good({ selected_position_ids: [secretary, groundsman] }));
    expect(r).toEqual({ received: true });
    const [a] = await rows<Record<string, unknown>>(db.admin, "select * from volunteer_applications");
    appId = a.id as string;
    expect(a).toMatchObject({ stage: "new", email_normalized: "applicant@example.org", unsure_role: true, commitment_bucket: "2to4", privacy_notice_version: "draft-2026-10-19" });
    expect(a.interests).toEqual(["refreshments", "secretary"]); // unknown codes dropped
    expect(a.strengths).toEqual(["administration", "organisation"]);
    expect(a.availability).toEqual([{ day: 5, daypart: "morning" }]); // de-duplicated, invalid dropped
    // only advertised roles can be chosen
    expect(a.selected_position_ids).toEqual([secretary]);
  });
  it("C37: no Auth account, no portal access, no person, no role, no message", async () => {
    expect(await rows(db.admin, "select 1 from auth.users where email = 'applicant@example.org'")).toHaveLength(0);
    expect(await rows(db.admin, "select 1 from people where email_normalized = 'applicant@example.org'")).toHaveLength(0);
    expect(await rows(db.admin, "select 1 from position_holders")).toHaveLength(0);
    expect(await rows(db.admin, "select 1 from notification_outbox")).toHaveLength(0);
  });
  it("is visible to admins only", async () => {
    expect(await call(db, admin, "select id from volunteer_applications")).toHaveLength(1);
    expect(await call(db, coord, "select id from volunteer_applications")).toHaveLength(0);
    expect(await call(db, member, "select id from volunteer_applications")).toHaveLength(0);
  });
  it("C40: suggestions explain themselves and flag roles needing checks; nothing is decided", async () => {
    const s = await rows<{ club_position_id: string; score: number; reasons: string[]; needs_checks: boolean }>(db.admin,
      "select club_position_id, score, reasons, needs_checks from application_role_suggestions where application_id = $1 order by score desc", [appId]);
    expect(s[0].club_position_id).toBe(secretary);
    expect(s[0].reasons).toEqual(expect.arrayContaining(["Chose this role on the form", "Interests match: secretary", "Strengths match the skills this role needs", "Happy to learn or shadow — useful for a handover"]));
    const w = s.find((x) => x.club_position_id === welfare);
    expect(w?.needs_checks).toBe(true);
    expect(w?.reasons).toContain("Needs club/FA checks: a human decision, never automatic");
    const [a] = await rows<{ stage: string }>(db.admin, "select stage from volunteer_applications where id = $1", [appId]);
    expect(a.stage).toBe("new");
  });
  it("the audit log records receipt without the applicant's answers", async () => {
    const [l] = await rows<{ new_data: Record<string, unknown>; source: string }>(db.admin, "select new_data, source from audit_log where entity_id = $1 and action = 'application_received'", [appId]);
    expect(l).toEqual({ new_data: { stage: "new" }, source: "public_form" });
    expect(JSON.stringify(await rows(db.admin, "select * from audit_log where entity_id = $1", [appId]))).not.toContain("PTA");
  });

  describe("H43 / review workflow", () => {
    it("admins move it through stages and record contact and follow-up without portal access", async () => {
      await callCommit(db, admin, "select public.hub_update_application($1, $2::jsonb)", [appId, JSON.stringify({ stage: "contacted", contacted_now: true, follow_up_on: "2026-11-01", admin_notes: "Phoned; keen." })]);
      await callCommit(db, admin, "select public.hub_update_application($1, $2::jsonb)", [appId, JSON.stringify({ stage: "trial" })]);
      const [a] = await rows<Record<string, unknown>>(db.admin, "select stage, follow_up_on::text f, admin_notes, last_contacted_at is not null contacted from volunteer_applications where id = $1", [appId]);
      expect(a).toEqual({ stage: "trial", f: "2026-11-01", admin_notes: "Phoned; keen.", contacted: true });
      expect(await rows(db.admin, "select 1 from user_accounts ua join people p on p.id = ua.person_id where p.email_normalized = 'applicant@example.org'")).toHaveLength(0);
    });
    it("creating a person from it copies their answers and still sends/invites nothing", async () => {
      const [{ id }] = await callCommit<{ id: string }>(db, admin, "select public.hub_create_person_from_application($1, true) id", [appId]);
      const [p] = await rows<Record<string, unknown>>(db.admin, "select full_name, routine_requests_enabled from people where id = $1", [id]);
      expect(p).toEqual({ full_name: "Applicant (demo)", routine_requests_enabled: true });
      expect(await rows(db.admin, "select 1 from usual_availability where person_id = $1", [id])).toHaveLength(1);
      expect(await rows(db.admin, "select 1 from user_accounts where person_id = $1", [id])).toHaveLength(0);
      const [pi] = await rows<{ person_id: string }>(db.admin, "select person_id from position_interests where application_id = $1", [appId]);
      expect(pi.person_id).toBe(id);
    });
    it("only admins can review", async () => {
      await expectCode(call(db, coord, "select public.hub_update_application($1, '{\"stage\":\"closed\"}'::jsonb)", [appId]), "not_authorised");
      await expectCode(call(db, member, "select public.hub_create_person_from_application($1)", [appId]), "not_authorised");
    });
  });
});

describe("C39 — possible duplicates are flagged, never merged", () => {
  it("an email or phone already in the directory is flagged, and the person's record is untouched", async () => {
    const pid = await plainPerson(db, "Existing Person", { email_normalized: "existing@example.org", phone_normalized: "+447700900666" });
    await submit(good({ full_name: "Exist Ing", email: "EXISTING@example.org", phone: "07700 900666", contact_preference: "phone" }));
    const [a] = await rows<{ id: string; duplicate_review_status: string; duplicate_candidates: { kind: string; id: string }[] }>(db.admin,
      "select id, duplicate_review_status, duplicate_candidates from volunteer_applications where full_name = 'Exist Ing'");
    expect(a.duplicate_review_status).toBe("possible_duplicate");
    expect(a.duplicate_candidates).toEqual([expect.objectContaining({ kind: "person", id: pid })]);
    const [p] = await rows<{ full_name: string }>(db.admin, "select full_name from people where id = $1", [pid]);
    expect(p.full_name).toBe("Existing Person");
    await expectCode(call(db, admin, "select public.hub_create_person_from_application($1)", [a.id]), "duplicate_email");
    await callCommit(db, admin, "select public.hub_link_application($1, $2)", [a.id, pid]);
    const [linked] = await rows<{ linked_person_id: string; duplicate_review_status: string }>(db.admin, "select linked_person_id, duplicate_review_status from volunteer_applications where id = $1", [a.id]);
    expect(linked).toEqual({ linked_person_id: pid, duplicate_review_status: "linked" });
    expect((await rows<{ full_name: string }>(db.admin, "select full_name from people where id = $1", [pid]))[0].full_name).toBe("Existing Person");
  });
});

describe("C41 / C42 — rejected safely", () => {
  it.each([
    [{ email: "", phone: "" }, "contact_required"],
    [{ email: "not-an-email" }, "invalid_email"],
    [{ privacy_acknowledged: false }, "privacy_required"],
    [{ contact_preference: "phone" }, "invalid_preference"],
    [{ full_name: "" }, "invalid_name"],
  ])("%j → %s", async (over, code) => {
    await expectCode(submit(good(over)), code);
  });
  it("C42: under-18s are refused by the server even if the form is bypassed", async () => {
    await expectCode(submit(good({ is_adult: false, email: "young@example.org" })), "under_18");
    expect(await rows(db.admin, "select 1 from volunteer_applications where email_normalized = 'young@example.org'")).toHaveLength(0);
  });
  it("rate limit: 5 per client key per hour, then refused without saving", async () => {
    const key = "same-client-key-0123456789";
    for (let i = 0; i < 5; i++) await submit(good({ email: `rate${i}@example.org` }), key);
    await expectCode(submit(good({ email: "rate5@example.org" }), key), "rate_limited");
    expect(await rows(db.admin, "select 1 from volunteer_applications where email_normalized = 'rate5@example.org'")).toHaveLength(0);
  });
  it("closing applications in settings stops submissions", async () => {
    await db.admin.query("update club_settings set applications_open = false");
    await expectCode(submit(good({ email: "closed@example.org" })), "applications_closed");
    await db.admin.query("update club_settings set applications_open = true");
  });
});

describe("C38 — anonymous visitors can't read or change anything", () => {
  it("no table access, no function access (submission is server-only)", async () => {
    for (const t of ["volunteer_applications", "application_role_suggestions", "hub_rate_events", "people", "hub_assignments", "audit_log", "notification_outbox", "club_positions", "position_holders"]) {
      await expect(db.asAnon((c) => c.query(`select * from ${t}`))).rejects.toThrow(/permission denied/);
    }
    await expect(db.asAnon((c) => c.query("select public.public_submit_application('{}'::jsonb, 'x')"))).rejects.toThrow(/permission denied/);
    await expect(call(db, member, "select public.public_submit_application('{}'::jsonb, 'x')")).rejects.toThrow(/permission denied/);
    await expect(db.asAnon((c) => c.query("insert into volunteer_applications (full_name) values ('x')"))).rejects.toThrow(/permission denied/);
  });
  it("the secret key can submit but can't read applications back", async () => {
    await expect(db.asService((c) => c.query("select * from volunteer_applications"))).rejects.toThrow(/permission denied/);
  });
});

describe("H44 — deletion and retention", () => {
  it("an admin can delete an application; an audit line without contents remains", async () => {
    await submit(good({ email: "delete-me@example.org" }));
    const [{ id }] = await rows<{ id: string }>(db.admin, "select id from volunteer_applications where email_normalized = 'delete-me@example.org'");
    await callCommit(db, admin, "select public.hub_delete_application($1)", [id]);
    expect(await rows(db.admin, "select 1 from volunteer_applications where id = $1", [id])).toHaveLength(0);
    const l = await rows<{ action: string; new_data: unknown }>(db.admin, "select action, new_data from audit_log where entity_id = $1 order by id", [id]);
    expect(l.map((x) => x.action)).toEqual(["application_received", "application_deleted"]);
    expect(JSON.stringify(l)).not.toContain("delete-me");
  });
  it("a configured retention period sets a review date; none is invented otherwise", async () => {
    await submit(good({ email: "noretention@example.org" }));
    const [a] = await rows<{ r: string | null }>(db.admin, "select retention_review_at::text r from volunteer_applications where email_normalized = 'noretention@example.org'");
    expect(a.r).toBeNull();
    await db.admin.query("update club_settings set application_retention_months = 12");
    await submit(good({ email: "retention@example.org" }));
    const [b] = await rows<{ r: string | null }>(db.admin, "select retention_review_at::text r from volunteer_applications where email_normalized = 'retention@example.org'");
    expect(b.r).not.toBeNull();
  });
});

describe("rollback script for Stage 6", () => {
  it("applies cleanly; club roles still work", async () => {
    const { readFileSync } = await import("node:fs");
    const scratch = await createTestDb({ stopBefore: "20261019000700" });
    try {
      await scratch.admin.query(`begin; ${readFileSync("docs/sql/rollback-20261019000600.sql", "utf8")}; commit;`);
      const m = await hubUser(scratch, "member");
      await scratch.asUser(m.uid, (c) => c.query("select public.hub_positions()"));
      expect(await rows(scratch.admin, "select 1 from pg_tables where tablename = 'volunteer_applications'")).toHaveLength(0);
    } finally {
      await scratch.drop();
    }
  });
});
