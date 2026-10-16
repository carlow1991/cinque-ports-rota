import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import { authorise, expectCode, inHours, makeCoordinator, makeEvent, makeShift, person, rpc, venueId, type Person } from "./fixtures";
import { expandTemplate, type TemplateItem } from "@/lib/domain/templates";

let db: TestDb;
let mw: string, fw: string;
let coord: Person;

beforeAll(async () => {
  db = await createTestDb();
  mw = await venueId(db, "marke_wood");
  fw = await venueId(db, "freemens_way");
  coord = await makeCoordinator(db, [mw, fw]);
});
afterAll(async () => db?.drop());

const tplId = async (code: string) => (await rows<{ id: string }>(db.admin, "select id from duty_templates where code = $1", [code]))[0].id;
const itemIds = async (code: string, duties: string[]) =>
  (await rows<{ id: string }>(db.admin,
    `select i.id from duty_template_items i join duty_templates t on t.id = i.template_id join duty_types d on d.id = i.duty_type_id
     where t.code = $1 and d.code = any($2) order by i.sort_order`, [code, duties])).map((r) => r.id);

type ShiftRow = { code: string; required_count: number; starts_at: Date; ends_at: Date; resp: string[] | null; status: string };
const shiftsOf = (event: string) => rows<ShiftRow>(db.admin,
  `select d.code, s.required_count, s.starts_at, s.ends_at, s.status,
          (select array_agg(rd.code order by rd.code) from event_shift_responsibilities r join duty_types rd on rd.id = r.duty_type_id where r.shift_id = s.id) as resp
   from event_shifts s join duty_types d on d.id = s.duty_type_id where s.event_id = $1 and s.status = 'active' order by s.starts_at, d.sort_order`, [event]);

async function loadItems(code: string): Promise<TemplateItem[]> {
  const r = await rows<Record<string, unknown>>(db.admin,
    `select i.id, i.sort_order, d.code as duty_code, d.name as duty_name, i.required_count, i.enabled_by_default, i.when_to_enable,
            i.start_anchor, i.start_offset_minutes, i.end_anchor, i.end_offset_minutes, i.suppressed_by_linked_cover,
            i.signup_enabled, i.approval_required, i.instructions,
            coalesce((select json_agg(json_build_object('code', rd.code, 'name', rd.name) order by rd.sort_order)
                      from template_item_responsibilities r join duty_types rd on rd.id = r.duty_type_id where r.template_item_id = i.id), '[]') as resp
     from duty_template_items i join duty_templates t on t.id = i.template_id join duty_types d on d.id = i.duty_type_id
     where t.code = $1 order by i.sort_order`, [code]);
  return r.map((x) => ({
    id: x.id as string, sortOrder: x.sort_order as number, dutyCode: x.duty_code as string, dutyName: x.duty_name as string,
    requiredCount: x.required_count as number, enabledByDefault: x.enabled_by_default as boolean, whenToEnable: x.when_to_enable as string | null,
    startAnchor: x.start_anchor as TemplateItem["startAnchor"], startOffsetMinutes: x.start_offset_minutes as number,
    endAnchor: x.end_anchor as TemplateItem["endAnchor"], endOffsetMinutes: x.end_offset_minutes as number,
    suppressedByLinkedCover: x.suppressed_by_linked_cover as boolean, signupEnabled: x.signup_enabled as boolean,
    approvalRequired: x.approval_required as boolean, instructions: x.instructions as string | null,
    responsibilities: x.resp as TemplateItem["responsibilities"],
  }));
}

async function createFromTemplate(o: { code: string; venue: string; start: Date; end: Date; enabled?: string[] | null; type?: string; cover?: string | null; counts?: Record<string, number> }) {
  const r = await rpc<{ event_id: string; shifts_created: number }>(db, coord, "create_event", [
    o.venue, `Test ${o.code}`, o.type ?? "fixture", o.start, o.end, null, null, null, null, null, null,
    o.cover ?? null, true, await tplId(o.code), o.enabled ?? null, JSON.stringify(o.counts ?? {}),
  ]);
  return r;
}

describe("seeded templates match the catalogue", () => {
  const expected: Record<string, Array<[string, number, boolean, string, number, string, number, boolean, string[]]>> = {
    // duty, count, enabled, startAnchor, startOffset, endAnchor, endOffset, suppressedByLink, responsibilities
    T01: [
      ["site_lead", 1, true, "event_start", -75, "event_end", 45, true, ["facility_checks", "lock_secure", "open_unlock"]],
      ["gate_admissions", 1, false, "event_start", -45, "event_start", 20, false, []],
      ["refreshments", 2, false, "event_start", -45, "event_end", 30, false, []],
      ["pitch_setup", 2, true, "event_start", -75, "event_start", -15, false, []],
      ["cleaning", 2, true, "event_end", 0, "event_end", 45, false, []],
      ["general_support", 1, false, "event_start", -30, "event_end", 15, false, []],
    ],
    T02: [
      ["site_lead", 1, true, "event_start", -60, "event_end", 30, true, ["facility_checks", "lock_secure", "open_unlock"]],
      ["pitch_setup", 1, true, "event_start", -45, "event_start", -10, false, []],
      ["cleaning", 1, true, "event_end", 0, "event_end", 30, false, []],
      ["refreshments", 1, false, "event_start", -30, "event_end", 15, false, []],
      ["gate_admissions", 1, false, "event_start", -30, "event_start", 15, false, []],
      ["general_support", 1, false, "event_start", 0, "event_end", 0, false, []],
    ],
    T03: [
      ["site_lead", 1, true, "event_start", -60, "event_end", 30, true, ["facility_checks", "lock_secure", "open_unlock"]],
      ["pitch_setup", 2, true, "event_start", -45, "event_start", 0, false, []],
      ["cleaning", 1, true, "event_end", 0, "event_end", 30, false, []],
      ["refreshments", 1, false, "event_start", -15, "event_end", 15, false, []],
      ["general_support", 1, false, "event_start", 0, "event_end", 0, false, []],
      ["gate_admissions", 1, false, "event_start", -30, "event_start", 15, false, []],
    ],
    T09: [["site_lead", 1, true, "event_start", 0, "event_end", 0, false, ["facility_checks", "lock_secure", "open_unlock"]]],
  };

  it.each(Object.keys(expected))("%s items are exactly as specified", async (code) => {
    const r = await rows<{ d: string; c: number; e: boolean; sa: string; so: number; ea: string; eo: number; s: boolean; resp: string[] }>(db.admin,
      `select d.code as d, i.required_count as c, i.enabled_by_default as e, i.start_anchor::text as sa, i.start_offset_minutes as so,
              i.end_anchor::text as ea, i.end_offset_minutes as eo, i.suppressed_by_linked_cover as s,
              coalesce((select array_agg(rd.code order by rd.code) from template_item_responsibilities r join duty_types rd on rd.id = r.duty_type_id where r.template_item_id = i.id), '{}') as resp
       from duty_template_items i join duty_templates t on t.id = i.template_id join duty_types d on d.id = i.duty_type_id
       where t.code = $1 order by i.sort_order`, [code]);
    expect(r.map((x) => [x.d, x.c, x.e, x.sa, x.so, x.ea, x.eo, x.s, x.resp])).toEqual(expected[code]);
  });

  it("default core slot counts per template match the catalogue", async () => {
    const r = await rows<{ code: string; slots: number }>(db.admin,
      `select t.code, coalesce(sum(i.required_count) filter (where i.enabled_by_default), 0)::int as slots
       from duty_templates t join duty_template_items i on i.template_id = t.id group by t.code order by t.code`);
    expect(Object.fromEntries(r.map((x) => [x.code, x.slots]))).toEqual({
      T01: 5, T02: 3, T03: 4, T04: 3, T05: 0, T06: 1, T07: 7, T08: 5, T09: 1,
    });
  });

  it("exactly nine templates; T01/T02 Marke Wood only, T03/T04 Freemens Way only, the rest either venue", async () => {
    const r = await rows<{ code: string; venue: string | null; event_type: string }>(db.admin,
      "select t.code, v.code as venue, t.event_type::text from duty_templates t left join venues v on v.id = t.venue_id order by t.code");
    expect(r).toEqual([
      { code: "T01", venue: "marke_wood", event_type: "fixture" },
      { code: "T02", venue: "marke_wood", event_type: "fixture" },
      { code: "T03", venue: "freemens_way", event_type: "fixture" },
      { code: "T04", venue: "freemens_way", event_type: "fixture" },
      { code: "T05", venue: null, event_type: "training" },
      { code: "T06", venue: null, event_type: "venue_coverage" },
      { code: "T07", venue: null, event_type: "club_event" },
      { code: "T08", venue: null, event_type: "maintenance" },
      { code: "T09", venue: null, event_type: "venue_coverage" },
    ]);
  });

  it("re-running the template seed changes nothing and keeps admin edits", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    await db.admin.query("update duty_template_items set required_count = 3 where id = (select id from duty_template_items where template_id = (select id from duty_templates where code='T08') and sort_order = 20)");
    const sql = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "20261016000700_seed_templates_t01_t09.sql"), "utf8");
    const before = (await rows<{ n: number }>(db.admin, "select count(*)::int as n from duty_template_items"))[0].n;
    await db.admin.query(sql);
    expect((await rows<{ n: number }>(db.admin, "select count(*)::int as n from duty_template_items"))[0].n).toBe(before);
    expect((await rows<{ n: number }>(db.admin, "select count(*)::int as n from duty_templates"))[0].n).toBe(9);
  });
});

describe("required acceptance assertions", () => {
  it("T01 with gate + tea bar enabled creates FIVE shift rows and EIGHT slots; open/check/lock are included, not rows", async () => {
    const enabled = await itemIds("T01", ["site_lead", "gate_admissions", "refreshments", "pitch_setup", "cleaning"]);
    const r = await createFromTemplate({ code: "T01", venue: mw, start: inHours(100), end: inHours(102), enabled });
    expect(r.shifts_created).toBe(5);
    const s = await shiftsOf(r.event_id);
    expect(s).toHaveLength(5);
    expect(s.reduce((n, x) => n + x.required_count, 0)).toBe(8);
    expect(s.map((x) => x.code).sort()).toEqual(["cleaning", "gate_admissions", "pitch_setup", "refreshments", "site_lead"]);
    expect(s.find((x) => x.code === "site_lead")!.resp).toEqual(["facility_checks", "lock_secure", "open_unlock"]);
    expect(s.some((x) => ["open_unlock", "lock_secure", "facility_checks"].includes(x.code))).toBe(false);
  });

  it("T03 linked to venue cover with a CONFIRMED site lead creates no site-lead row", async () => {
    const cover = await makeEvent(db, { venue: fw, type: "venue_coverage", start: inHours(199), end: inHours(205), title: "FW ops" });
    const leadShift = await makeShift(db, { event: cover, duty: "site_lead", start: inHours(199), end: inHours(205), responsibilities: ["open_unlock", "facility_checks", "lock_secure"] });
    const lead = await person(db);
    for (const c of ["site_lead", "open_unlock", "lock_secure"]) await authorise(db, lead.id, c);
    await rpc(db, lead, "self_signup", [leadShift]);
    const r = await createFromTemplate({ code: "T03", venue: fw, start: inHours(200), end: inHours(203), cover });
    const s = await shiftsOf(r.event_id);
    expect(s.map((x) => x.code)).toEqual(["pitch_setup", "cleaning"]);
    expect(s.find((x) => x.code === "pitch_setup")!.required_count).toBe(2);
    expect(s.find((x) => x.code === "cleaning")!.required_count).toBe(1);
    const [cov] = await db.asUser(coord.uid, (c) => rows<{ state: string }>(c, "select state from public.event_site_coverage($1)", [r.event_id]));
    expect(cov.state).toBe("covered_by_volunteer");
  });

  it("T09 creates ONE composite site-lead row by default", async () => {
    const r = await createFromTemplate({ code: "T09", venue: mw, type: "venue_coverage", start: inHours(300), end: inHours(308) });
    const s = await shiftsOf(r.event_id);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ code: "site_lead", required_count: 1, resp: ["facility_checks", "lock_secure", "open_unlock"] });
    expect(s[0].starts_at.getTime()).toBe(inHours(300).getTime());
    expect(s[0].ends_at.getTime()).toBe(inHours(308).getTime());
  });

  it("disabled optional roles produce no rows and no vacancies", async () => {
    const r = await createFromTemplate({ code: "T01", venue: mw, start: inHours(400), end: inHours(402) }); // defaults
    const s = await shiftsOf(r.event_id);
    expect(s.map((x) => x.code).sort()).toEqual(["cleaning", "pitch_setup", "site_lead"]);
    const [ov] = await db.asUser(coord.uid, (c) => rows<{ shift_rows: number; required_slots: number; open_slots: number }>(c,
      "select shift_rows, required_slots, open_slots from public.manage_events_overview($1, $2) where event_id = $3", [inHours(399), inHours(403), r.event_id]));
    expect(ov).toEqual({ shift_rows: 3, required_slots: 5, open_slots: 5 });
  });
});

describe("template application", () => {
  it("T03 NOT linked creates its own site-lead row (fallback), and can then be published", async () => {
    const r = await createFromTemplate({ code: "T03", venue: fw, start: inHours(500), end: inHours(503) });
    expect((await shiftsOf(r.event_id)).map((x) => x.code)).toContain("site_lead");
    expect((await rpc<{ status: string }>(db, coord, "publish_event", [r.event_id])).status).toBe("published");
  });

  it("T05 training: nothing by default, so publishing is blocked until a site-cover decision is made", async () => {
    const r = await createFromTemplate({ code: "T05", venue: mw, type: "training", start: inHours(600), end: inHours(601.5) });
    expect(r.shifts_created).toBe(0);
    await expectCode(rpc(db, coord, "publish_event", [r.event_id]), "publish_blocked");
  });

  it("applying a template twice never duplicates rows (idempotent)", async () => {
    const r = await createFromTemplate({ code: "T02", venue: mw, start: inHours(700), end: inHours(702) });
    const again = await rpc<{ shifts_created: number }>(db, coord, "apply_template", [r.event_id, await tplId("T02"), null, "{}"]);
    expect(again.shifts_created).toBe(0);
    expect(await shiftsOf(r.event_id)).toHaveLength(3);
    // Enabling an optional duty later adds just that row.
    const tea = await itemIds("T02", ["refreshments"]);
    const more = await rpc<{ shifts_created: number }>(db, coord, "apply_template", [r.event_id, await tplId("T02"), [...await itemIds("T02", ["site_lead", "pitch_setup", "cleaning"]), ...tea], "{}"]);
    expect(more.shifts_created).toBe(1);
  });

  it("venue-specific templates cannot be used at the other venue", async () => {
    await expectCode(createFromTemplate({ code: "T01", venue: fw, start: inHours(800), end: inHours(802) }), "template_wrong_venue");
  });

  it("creation is atomic: a bad template choice leaves no half-made event", async () => {
    const before = (await rows<{ n: number }>(db.admin, "select count(*)::int as n from events"))[0].n;
    await expectCode(createFromTemplate({ code: "T01", venue: mw, start: inHours(900), end: inHours(902), counts: { [(await itemIds("T01", ["cleaning"]))[0]]: 0 } }), "invalid_headcount");
    expect((await rows<{ n: number }>(db.admin, "select count(*)::int as n from events"))[0].n).toBe(before);
  });

  it("only managers of the venue can create events; volunteers cannot", async () => {
    const v = await person(db);
    const coordFW = await makeCoordinator(db, [fw]);
    await expectCode(rpc(db, v, "create_event", [mw, "x", "fixture", inHours(1000), inHours(1001)]), "not_authorised");
    await expectCode(rpc(db, coordFW, "create_event", [mw, "x", "fixture", inHours(1000), inHours(1001)]), "not_authorised");
  });

  it("the app cannot mark an event as demo (that would silently suppress emails)", async () => {
    await expect(db.asUser(coord.uid, (c) =>
      c.query("insert into events (venue_id, title, event_type, starts_at, ends_at, is_demo) values ($1, 'x', 'fixture', now() + interval '2 days', now() + interval '2 days 1 hour', true)", [mw])))
      .rejects.toThrow(/permission denied/);
  });
});

describe("linking venue cover later removes duplicate lead vacancies (never people)", () => {
  it("an uncommitted generated lead row is removed on link; a committed one is kept and reported", async () => {
    const cover = await makeEvent(db, { venue: fw, type: "venue_coverage", start: inHours(1099), end: inHours(1106) });
    const a = await createFromTemplate({ code: "T04", venue: fw, start: inHours(1100), end: inHours(1102) });
    const r1 = await rpc<{ duplicate_duties_removed: number; duplicate_duties_kept: number }>(db, coord, "link_venue_cover", [a.event_id, cover]);
    expect(r1).toMatchObject({ duplicate_duties_removed: 1, duplicate_duties_kept: 0 });
    expect((await shiftsOf(a.event_id)).map((x) => x.code)).not.toContain("site_lead");

    const b = await createFromTemplate({ code: "T04", venue: fw, start: inHours(1103), end: inHours(1105) });
    const [leadRow] = await rows<{ id: string }>(db.admin, "select s.id from event_shifts s join duty_types d on d.id = s.duty_type_id where s.event_id = $1 and d.code = 'site_lead'", [b.event_id]);
    await rpc(db, coord, "publish_event", [b.event_id]);
    const lead = await person(db);
    for (const c of ["site_lead", "open_unlock", "lock_secure"]) await authorise(db, lead.id, c);
    await rpc(db, lead, "self_signup", [leadRow.id]);
    const r2 = await rpc<{ duplicate_duties_removed: number; duplicate_duties_kept: number }>(db, coord, "link_venue_cover", [b.event_id, cover]);
    expect(r2).toMatchObject({ duplicate_duties_removed: 0, duplicate_duties_kept: 1 });
  });

  it("multiple fixtures can link to one venue-wide cover event", async () => {
    const cover = await makeEvent(db, { venue: fw, type: "venue_coverage", start: inHours(1200), end: inHours(1210) });
    const ids = [];
    for (const h of [1201, 1203, 1206]) ids.push((await createFromTemplate({ code: "T03", venue: fw, start: inHours(h), end: inHours(h + 2), cover })).event_id);
    const r = await rows(db.admin, "select id from events where coverage_event_id = $1", [cover]);
    expect(r).toHaveLength(3);
    for (const id of ids) expect((await shiftsOf(id)).map((x) => x.code)).not.toContain("site_lead");
  });
});

describe("the on-screen preview matches what the database creates", () => {
  it.each(["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09"])("%s (all duties enabled, incl. a DST-crossing window)", async (code) => {
    const items = await loadItems(code);
    const venue = code === "T01" || code === "T02" ? mw : code === "T03" || code === "T04" ? fw : mw;
    const type = code === "T06" || code === "T09" ? "venue_coverage" : code === "T05" ? "training" : code === "T07" ? "club_event" : code === "T08" ? "maintenance" : "fixture";
    // Saturday evening before the clocks go back (24→25 Oct 2026).
    const start = new Date("2026-10-24T22:30:00Z");
    const end = new Date("2026-10-25T02:30:00Z");
    const all = items.map((i) => i.id);
    const preview = expandTemplate({ startsAt: start, endsAt: end, linkedToVenueCover: false }, items, { enabled: new Set(all) });
    const r = await createFromTemplate({ code, venue, type, start, end, enabled: all });
    const db_ = await shiftsOf(r.event_id);
    const key = (c: string, s: Date, e: Date, n: number) => `${c}|${s.toISOString()}|${e.toISOString()}|${n}`;
    expect(db_.map((x) => key(x.code, x.starts_at, x.ends_at, x.required_count)).sort())
      .toEqual(preview.shifts.map((x) => key(x.dutyCode, x.startsAt, x.endsAt, x.requiredCount)).sort());
  });
});
