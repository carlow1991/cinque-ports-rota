"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CONNECTIONS, HEARD_FROM, stepOne, stepThree, stepTwo } from "@/lib/domain/application-form";
import { COMMITMENT_BUCKETS, COMMITMENT_PATTERNS, DAYPARTS, DAYS, INTEREST_GROUPS, LOCATION_PREFS, STRENGTHS } from "@/lib/domain/hub-tags";

type Role = { id: string; title: string };
type Slot = { day: number; daypart: "morning" | "afternoon" | "evening" };

const input = "block w-full rounded-lg border border-line bg-white px-3 py-2 text-base";
const STEPS = ["About you", "How you'd like to help", "Your availability"] as const;

function Q({ label, hint, error, children, id }: { label: string; hint?: string; error?: string; children: ReactNode; id: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-semibold">{label}</label>
      {hint ? <p id={`${id}-hint`} className="text-xs text-ink-muted">{hint}</p> : null}
      {children}
      {error ? <p id={`${id}-error`} role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
    </div>
  );
}

function Choice({ name, value, checked, onChange, children, type = "radio", disabled }: {
  name: string; value: string; checked: boolean; onChange: () => void; children: ReactNode; type?: "radio" | "checkbox"; disabled?: boolean }) {
  return (
    <label className={`flex min-h-11 items-start gap-3 py-1 ${disabled ? "opacity-50" : ""}`}>
      <input type={type} name={name} value={value} checked={checked} onChange={onChange} disabled={disabled} className="mt-1 h-5 w-5 shrink-0 accent-[var(--club-primary)]" />
      <span className="text-sm">{children}</span>
    </label>
  );
}

/**
 * Three short steps, kept in memory only (nothing is saved until "Send"). Back keeps answers.
 * Under-18s are directed to contact the club with a parent or carer instead of continuing.
 */
export function ApplyForm({ roles, preselect, clubContact }: { roles: Role[]; preselect?: string; clubContact: string }) {
  const startedAt = useRef<number>(0);
  useEffect(() => { startedAt.current = Date.now(); }, []);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [serverError, setServerError] = useState("");
  const [f, setF] = useState({
    full_name: "", email: "", phone: "", contact_preference: "" as string, existing_club_connection: "", heard_from: "", adult: "" as "" | "yes" | "no",
    interests: [] as string[], unsure_role: false, selected_position_ids: preselect && roles.some((r) => r.id === preselect) ? [preselect] : ([] as string[]),
    strengths: [] as string[], experience_text: "", willing_to_learn: "",
    commitment_bucket: "", commitment_pattern: "", availability: [] as Slot[], availability_varies: false, work_location_preference: "",
    free_notes: "", privacy_acknowledged: false, communication_opt_in: false, website: "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (k: "interests" | "strengths" | "selected_position_ids", code: string) =>
    setF((x) => ({ ...x, [k]: x[k].includes(code) ? x[k].filter((c) => c !== code) : [...x[k], code] }));
  const hasSlot = (day: number, part: string) => f.availability.some((s) => s.day === day && s.daypart === part);
  const toggleSlot = (day: number, part: Slot["daypart"]) =>
    setF((x) => ({ ...x, availability: hasSlot(day, part) ? x.availability.filter((s) => !(s.day === day && s.daypart === part)) : [...x.availability, { day, daypart: part }] }));

  const payload = useMemo(() => ({ ...f, is_adult: f.adult === "yes", willing_to_learn: f.willing_to_learn }), [f]);

  function check(n: number): boolean {
    const schema = n === 0 ? stepOne : n === 1 ? stepTwo : stepThree;
    const r = schema.safeParse(payload);
    if (r.success) { setErrors({}); return true; }
    const e: Record<string, string> = {};
    for (const i of r.error.issues) { const k = String(i.path[0] ?? "form"); if (!e[k]) e[k] = i.message; }
    setErrors(e);
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid=true], [role=alert]")?.focus?.());
    return false;
  }

  async function send() {
    if (!check(2)) return;
    setStatus("sending"); setServerError("");
    try {
      const res = await fetch("/api/public/volunteer-applications", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, form_started_at: startedAt.current }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && j.ok) { setStatus("done"); window.scrollTo({ top: 0 }); return; }
      setServerError(j.error ?? "Sorry, something went wrong. Please try again."); setStatus("error");
    } catch {
      setServerError("We couldn't reach the club's website. Check your connection and try again — your answers are still here."); setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div role="status" className="rounded-xl border border-ok/30 bg-green-50 p-5">
        <h2 className="text-xl font-bold text-ok">Thank you</h2>
        <p className="mt-2">Thank you for offering to help. Your details have been received and someone from Cinque Ports FC will contact you if there is a suitable opportunity.</p>
        <p className="mt-2 text-sm text-ink-muted">You don&apos;t need an account, and we haven&apos;t created one.</p>
      </div>
    );
  }

  const err = (k: string) => errors[k];
  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); if (step < 2) { if (check(step)) { setStep(step + 1); window.scrollTo({ top: 0 }); } } else void send(); }}
      className="space-y-5" aria-describedby="progress">
      <ol id="progress" className="flex flex-wrap gap-2 text-sm" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined}
            className={`rounded-full border px-3 py-1 ${i === step ? "border-club bg-club font-semibold text-white" : i < step ? "border-ok text-ok" : "border-line text-ink-muted"}`}>
            {i + 1} {s}
          </li>
        ))}
      </ol>
      {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set("website", e.target.value)} name="website" /></label>
      </div>

      {step === 0 ? (
        <fieldset className="space-y-4">
          <legend className="text-xl font-bold text-club">About you</legend>
          <Q id="full_name" label="Full name" error={err("full_name")}>
            <input id="full_name" className={input} autoComplete="name" maxLength={120} value={f.full_name} aria-invalid={Boolean(err("full_name"))} onChange={(e) => set("full_name", e.target.value)} />
          </Q>
          <Q id="email" label="Email address" hint="An email address or a phone number is needed — either is fine." error={err("email")}>
            <input id="email" type="email" className={input} autoComplete="email" maxLength={254} value={f.email} aria-invalid={Boolean(err("email"))} onChange={(e) => set("email", e.target.value)} />
          </Q>
          <Q id="phone" label="Telephone number" error={err("phone")}>
            <input id="phone" type="tel" inputMode="tel" className={input} autoComplete="tel" maxLength={30} value={f.phone} aria-invalid={Boolean(err("phone"))} onChange={(e) => set("phone", e.target.value)} />
          </Q>
          <fieldset aria-invalid={Boolean(err("contact_preference"))}>
            <legend className="text-sm font-semibold">How would you prefer we contact you?</legend>
            <Choice name="pref" value="email" checked={f.contact_preference === "email"} onChange={() => set("contact_preference", "email")} disabled={!f.email}>Email</Choice>
            <Choice name="pref" value="phone" checked={f.contact_preference === "phone"} onChange={() => set("contact_preference", "phone")} disabled={!f.phone}>Phone call</Choice>
            <Choice name="pref" value="whatsapp" checked={f.contact_preference === "whatsapp"} onChange={() => set("contact_preference", "whatsapp")} disabled={!f.phone}>WhatsApp</Choice>
            <Choice name="pref" value="no_preference" checked={f.contact_preference === "no_preference"} onChange={() => set("contact_preference", "no_preference")}>No preference</Choice>
            {err("contact_preference") ? <p role="alert" className="text-sm font-medium text-danger">{err("contact_preference")}</p> : null}
          </fieldset>
          <Q id="connection" label="Are you already connected to the club? (optional)">
            <select id="connection" className={input} value={f.existing_club_connection} onChange={(e) => set("existing_club_connection", e.target.value)}>
              <option value="">Prefer not to say</option>{CONNECTIONS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </Q>
          <Q id="heard" label="How did you hear about volunteering? (optional)">
            <select id="heard" className={input} value={f.heard_from} onChange={(e) => set("heard_from", e.target.value)}>
              <option value="">Prefer not to say</option>{HEARD_FROM.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </Q>
          <fieldset aria-invalid={Boolean(err("is_adult"))}>
            <legend className="text-sm font-semibold">Are you 18 or over?</legend>
            <Choice name="adult" value="yes" checked={f.adult === "yes"} onChange={() => set("adult", "yes")}>Yes</Choice>
            <Choice name="adult" value="no" checked={f.adult === "no"} onChange={() => set("adult", "no")}>No</Choice>
            {err("is_adult") && f.adult === "" ? <p role="alert" className="text-sm font-medium text-danger">Please answer this question.</p> : null}
          </fieldset>
          {f.adult === "no" ? (
            <div role="status" className="rounded-lg border border-club-blue/30 bg-blue-50 p-4 text-sm">
              <p className="font-semibold">Thank you for wanting to help!</p>
              <p className="mt-1">This online form is for adults. Young volunteers are very welcome — please ask a parent or carer to contact the club with you at <strong>{clubContact}</strong>, and we&apos;ll talk about how you could get involved. Please don&apos;t send us any of your details through this form.</p>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {step === 1 ? (
        <fieldset className="space-y-5">
          <legend className="text-xl font-bold text-club">How you&apos;d like to help</legend>
          <div className="rounded-lg border-2 border-club-blue/40 bg-white p-3">
            <Choice type="checkbox" name="unsure" value="1" checked={f.unsure_role} onChange={() => set("unsure_role", !f.unsure_role)}>
              <strong>I&apos;m not sure — please help me find a role</strong>
            </Choice>
          </div>
          <fieldset aria-invalid={Boolean(err("interests"))}>
            <legend className="text-sm font-semibold">What would you enjoy helping with?</legend>
            {INTEREST_GROUPS.map((g) => (
              <div key={g.group} className="mt-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{g.group}</p>
                <div className="grid gap-x-4 sm:grid-cols-2">
                  {g.items.map((i) => <Choice key={i.code} type="checkbox" name="interests" value={i.code} checked={f.interests.includes(i.code)} onChange={() => toggle("interests", i.code)}>{i.label}</Choice>)}
                </div>
              </div>
            ))}
            {err("interests") ? <p role="alert" className="text-sm font-medium text-danger">{err("interests")}</p> : null}
          </fieldset>
          {roles.length ? (
            <fieldset>
              <legend className="text-sm font-semibold">Are you interested in any advertised roles? (optional)</legend>
              {roles.map((r) => <Choice key={r.id} type="checkbox" name="roles" value={r.id} checked={f.selected_position_ids.includes(r.id)} onChange={() => toggle("selected_position_ids", r.id)}>{r.title}</Choice>)}
            </fieldset>
          ) : null}
          <fieldset>
            <legend className="text-sm font-semibold">What are your strengths? (optional)</legend>
            <div className="grid gap-x-4 sm:grid-cols-2">
              {STRENGTHS.map((s) => <Choice key={s.code} type="checkbox" name="strengths" value={s.code} checked={f.strengths.includes(s.code)} onChange={() => toggle("strengths", s.code)}>{s.label}</Choice>)}
            </div>
          </fieldset>
          <Q id="experience" label="Any relevant skills, experience or interests? (optional)" hint="Up to 1,000 characters. Please don't include health, criminal record, DBS or ID details." error={err("experience_text")}>
            <textarea id="experience" rows={4} maxLength={1000} className={input} value={f.experience_text} onChange={(e) => set("experience_text", e.target.value)} />
          </Q>
          <fieldset>
            <legend className="text-sm font-semibold">Would you be happy learning a role or shadowing someone?</legend>
            {[["yes", "Yes"], ["maybe", "Maybe"], ["no", "No"]].map(([v, l]) => <Choice key={v} name="learn" value={v} checked={f.willing_to_learn === v} onChange={() => set("willing_to_learn", v)}>{l}</Choice>)}
          </fieldset>
        </fieldset>
      ) : null}

      {step === 2 ? (
        <fieldset className="space-y-5">
          <legend className="text-xl font-bold text-club">Your availability</legend>
          <fieldset aria-invalid={Boolean(err("commitment_bucket"))}>
            <legend className="text-sm font-semibold">Roughly how much time could you offer?</legend>
            {COMMITMENT_BUCKETS.map((c) => <Choice key={c.code} name="bucket" value={c.code} checked={f.commitment_bucket === c.code} onChange={() => set("commitment_bucket", c.code)}>{c.label}</Choice>)}
            {err("commitment_bucket") ? <p role="alert" className="text-sm font-medium text-danger">{err("commitment_bucket")}</p> : null}
          </fieldset>
          <fieldset aria-invalid={Boolean(err("commitment_pattern"))}>
            <legend className="text-sm font-semibold">What type of involvement suits you?</legend>
            {COMMITMENT_PATTERNS.map((c) => <Choice key={c.code} name="pattern" value={c.code} checked={f.commitment_pattern === c.code} onChange={() => set("commitment_pattern", c.code)}>{c.label}</Choice>)}
            {err("commitment_pattern") ? <p role="alert" className="text-sm font-medium text-danger">{err("commitment_pattern")}</p> : null}
          </fieldset>
          <fieldset>
            <legend className="text-sm font-semibold">When are you generally available?</legend>
            <p className="text-xs text-ink-muted">A rough guide only — it doesn&apos;t sign you up for anything.</p>
            <Choice type="checkbox" name="varies" value="1" checked={f.availability_varies} onChange={() => set("availability_varies", !f.availability_varies)}>It varies</Choice>
            <table className="mt-1 w-full text-sm">
              <thead><tr><th className="sr-only">Day</th>{DAYPARTS.map((d) => <th key={d.code} scope="col" className="px-1 text-left font-semibold">{d.label}</th>)}</tr></thead>
              <tbody>
                {DAYS.map((day, i) => (
                  <tr key={day} className="border-t border-line">
                    <th scope="row" className="py-1 pr-2 text-left font-semibold">{day}</th>
                    {DAYPARTS.map((d) => (
                      <td key={d.code} className="px-1">
                        <label className="flex min-h-11 items-center">
                          <input type="checkbox" checked={hasSlot(i, d.code)} onChange={() => toggleSlot(i, d.code)} className="h-5 w-5 accent-[var(--club-primary)]" />
                          <span className="sr-only">{day} {d.label}</span>
                        </label>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </fieldset>
          <fieldset aria-invalid={Boolean(err("work_location_preference"))}>
            <legend className="text-sm font-semibold">Where would you prefer to help?</legend>
            {LOCATION_PREFS.map((c) => <Choice key={c.code} name="where" value={c.code} checked={f.work_location_preference === c.code} onChange={() => set("work_location_preference", c.code)}>{c.label}</Choice>)}
            {err("work_location_preference") ? <p role="alert" className="text-sm font-medium text-danger">{err("work_location_preference")}</p> : null}
          </fieldset>
          <Q id="notes" label="Anything else you'd like us to know? (optional)" error={err("free_notes")}>
            <textarea id="notes" rows={3} maxLength={1000} className={input} value={f.free_notes} onChange={(e) => set("free_notes", e.target.value)} />
          </Q>
          <div className="space-y-1 rounded-lg bg-surface-muted p-3">
            <Choice type="checkbox" name="privacy" value="1" checked={f.privacy_acknowledged} onChange={() => set("privacy_acknowledged", !f.privacy_acknowledged)}>
              I&apos;ve read the <Link href="/privacy" target="_blank" className="font-semibold text-club-blue underline">privacy notice</Link> (opens in a new tab), which explains how the club uses these details to follow up my offer.
            </Choice>
            {err("privacy_acknowledged") ? <p role="alert" className="text-sm font-medium text-danger">{err("privacy_acknowledged")}</p> : null}
            <Choice type="checkbox" name="news" value="1" checked={f.communication_opt_in} onChange={() => set("communication_opt_in", !f.communication_opt_in)}>
              Optional: I&apos;d also like to receive general club news. (Separate from your offer to help — saying no changes nothing.)
            </Choice>
          </div>
        </fieldset>
      ) : null}

      {serverError ? <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 p-3 text-sm font-medium text-danger">{serverError}</p> : null}
      <div className="flex flex-wrap gap-3">
        {step > 0 ? <button type="button" onClick={() => { setErrors({}); setStep(step - 1); }} className="min-h-11 rounded-lg border border-line bg-white px-4 font-semibold text-club">Back</button> : null}
        {!(step === 0 && f.adult === "no") ? (
          <button type="submit" disabled={status === "sending"} className="min-h-11 rounded-lg bg-club px-5 font-semibold text-white disabled:opacity-60">
            {step < 2 ? "Next" : status === "sending" ? "Sending…" : "Send my volunteering interest"}
          </button>
        ) : null}
      </div>
    </form>
  );
}
