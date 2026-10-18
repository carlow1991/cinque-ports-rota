import { describe, expect, it } from "vitest";
import { stepOne, validateApplication } from "@/lib/domain/application-form";

const ok = {
  full_name: "A Person", email: "a@example.org", phone: "", contact_preference: "email", is_adult: true,
  interests: ["refreshments", "not_a_code"], unsure_role: false, selected_position_ids: [], strengths: ["organisation"], experience_text: "", willing_to_learn: "",
  commitment_bucket: "lt2", commitment_pattern: "one_off", availability: [], availability_varies: true, work_location_preference: "onsite",
  free_notes: "", privacy_acknowledged: true, communication_opt_in: false,
};

describe("public application validation (C41, C42)", () => {
  it("accepts a complete application and drops unknown interest codes", () => {
    const r = validateApplication(ok);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.interests).toEqual(["refreshments"]);
  });
  it("reports every step-1 problem at once", () => {
    const r = stepOne.safeParse({ ...ok, email: "", phone: "", contact_preference: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path[0]).sort()).toEqual(["contact_preference", "email"]);
  });
  it.each([
    [{ email: "", phone: "" }, /email address or a phone/],
    [{ contact_preference: "phone" }, /Add a phone number/],
    [{ is_adult: false }, /for adults/],
    [{ privacy_acknowledged: false }, /privacy notice/],
    [{ unsure_role: false, interests: [] }, /not sure/],
    [{ experience_text: "x".repeat(1001) }, /1,000/],
  ])("%j is refused", (over, msg) => {
    const r = validateApplication({ ...ok, ...over });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });
  it("“not sure” alone is enough", () => {
    expect(validateApplication({ ...ok, interests: [], unsure_role: true }).ok).toBe(true);
  });
});
