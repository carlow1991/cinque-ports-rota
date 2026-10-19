import { describe, expect, it } from "vitest";
import { availabilityText, buildCards, headcount, type Involvement } from "@/lib/domain/involvement";

const base: Involvement = { can_manage: true, assignments: [], expected: [], availability: [], requests: [], my_request: false };
const t = (h: string) => `2026-11-07T${h}:00.000Z`;

describe("one card per person, strongest section wins (C47)", () => {
  it("someone who said yes AND was then confirmed appears once, under Confirmed, with both badges", () => {
    const inv: Involvement = { ...base,
      availability: [{ person_id: "bob", name: "Bob", response: "yes", for_full_event: true, available_from: null, available_until: null, response_source: "self" }],
      assignments: [{ id: "a", person_id: "bob", name: "Bob", label: "Matchday support", begins_at: null, ends_at: null, state: "confirmed", response_source: "self", invitation_source: "portal" }],
      requests: [{ person_id: "bob", name: "Bob", requested_at: t("10:00"), delivery_state: "sent", replied: true }] };
    const s = buildCards(inv, true);
    expect(s.map((x) => x.section)).toEqual(["confirmed"]);
    expect(s[0].cards[0].badges.map((b) => b.text)).toEqual(["Confirmed", "Said they can help"]);
  });
  it("expected and available are never shown as confirmed", () => {
    const inv: Involvement = { ...base,
      expected: [{ person_id: "scott", name: "Scott", role: "Manager", override: null }],
      availability: [{ person_id: "kelly", name: "Kelly", response: "yes", for_full_event: false, available_from: t("09:00"), available_until: t("13:00"), response_source: "self" }] };
    const s = buildCards(inv, true);
    expect(s.map((x) => x.section)).toEqual(["expected", "available"]);
    const all = s.flatMap((x) => x.cards.flatMap((c) => c.badges.map((b) => b.text)));
    expect(all.some((b) => /^Confirmed/.test(b))).toBe(false);
    expect(all).toContain("Manager — expected, not confirmed");
  });
  it("pending invitation = awaiting; organiser-recorded confirmation says so", () => {
    const inv: Involvement = { ...base, assignments: [
      { id: "1", person_id: "s", name: "Steve", label: null, begins_at: null, ends_at: null, state: "pending", response_source: null, invitation_source: "portal" },
      { id: "2", person_id: "p", name: "Pat", label: "Tea bar", begins_at: null, ends_at: null, state: "confirmed", response_source: "admin_recorded", invitation_source: "offline", recorded_by: "Alex" }] };
    const s = buildCards(inv, true);
    expect(s.find((x) => x.section === "awaiting")!.cards[0].badges[0].text).toBe("Invited — awaiting reply");
    expect(s.find((x) => x.section === "confirmed")!.cards[0].badges[0].text).toBe("Confirmed — recorded by organiser");
  });
  it("only people asked and not replied are 'not replied' (C18)", () => {
    const inv: Involvement = { ...base, requests: [
      { person_id: "k", name: "Kelly", requested_at: t("10:00"), delivery_state: "sent", replied: false },
      { person_id: "a", name: "Adam", requested_at: t("10:00"), delivery_state: "sent", replied: true }] };
    const s = buildCards(inv, true);
    expect(s).toHaveLength(1);
    expect(s[0].cards.map((c) => c.name)).toEqual(["Kelly"]);
  });
  it("headcount counts each person once", () => {
    const inv: Involvement = { ...base,
      assignments: [{ id: "1", person_id: "k", name: "Kelly", label: "Café", begins_at: null, ends_at: null, state: "confirmed", response_source: "self", invitation_source: "portal" }],
      venue_cover: [{ id: "v", person_id: "k", name: "Kelly", label: "Café", begins_at: t("09:00"), ends_at: t("13:00"), coverage: "full" }],
      availability: [{ person_id: "k", name: "Kelly", response: "yes", for_full_event: true, available_from: null, available_until: null, response_source: "self" }] };
    expect(headcount(inv, true)).toMatchObject({ confirmed: 1, venue: 0, available: 0 });
  });
});

describe("availability wording", () => {
  it("is honest about an unknown finish", () => {
    expect(availabilityText({ response: "yes", for_full_event: true, available_from: null, available_until: null }, false)).toBe("Available for the whole event (finish not recorded)");
    expect(availabilityText({ response: "no", for_full_event: false, available_from: null, available_until: null }, true)).toBe("Can't help");
  });
});
