# Decisions log

Each entry has a status: **PROPOSED** means it is awaiting Carl's answer, **AGREED** means it is confirmed, and **SUPERSEDED** means it has been replaced. Anything still PROPOSED when its phase starts is built using the proposed default and flagged in that phase's report.

## Fixed (from the Spec and Catalogue; not open)
- D-001: This is a standalone repository and Supabase project, with no Carl OS access. **AGREED**
- D-002: Exactly nine duty codes, with no Parking or Steward duty. **AGREED**
- D-003: Invitations reserve no place. A `pending_approval` assignment reserves one place. Only `confirmed` counts as cover. **AGREED**
- D-004: Included responsibilities never add headcount or vacancies. **AGREED**
- D-005: No deployment and no real email sends without explicit approval. **AGREED**

## Open questions with proposed answers

### Q1 — Where the code lives and runs · **AGREED 16 Oct 2026: private GitHub repository**
This workspace currently cannot reach the npm registry, and it has no Docker daemon.
**Proposed:** Create a private GitHub repository `cinque-ports-rota` owned by the club, or by Carl on the club's behalf, and push Phase 0 to it. Do Phases 1–3 in an environment that has npm access, which could be this one if access returns, or a folder connected on Carl's computer.

### Q2 — Timings the Catalogue does not specify · PROPOSED
The Catalogue omits timings for some optional items. Proposed defaults are below. All of them are editable per event.

| Template | Item | Proposed timing |
|---|---|---|
| T02, T04 | General support (optional) | start → end |
| T03 | General support (optional) | start → end ("during event") |
| T04 | Refreshments (optional) | start −30 → end +15 (same as T02) |
| T04 | Gate (optional) | start −30 → start +15 (same as T02) |
| T05 | Site lead (conditional) | start −15 → end +15 |
| T06, T08, T09 | Site lead ("full period") | start +0 → end +0. The coverage event's own start and end define the operational window. |
| T06 | Refreshments / gate / general support (optional) | start → end |
| T07 | General support ×2 | start → end |
| T07 | Refreshments (optional) | start −30 → end +15 |
| T07 | Gate (optional) | start −30 → start +30 |
| T08 | General support ×3 | start → end |
| T08 | Setup (optional) | start −30 → start |
| T03 | Site lead (fallback, not linked) | start −60 → end +30 |

### Q3 — T03 gate row and T05 site lead · PROPOSED
- **T03 gate** ("0, off"): seed it as a disabled optional item with the guidance "Not normally used; enable only if the club collects admission". This matches the general optional-item mechanism and creates no row unless an organiser enables it.
- **T05 site lead** ("conditional"): seed it as `enabled_by_default=false`. The event has `site_responsibility` defaulting to **true**. Publishing is blocked unless one of the following applies:
  1. A site-lead shift is enabled.
  2. Adequate linked cover exists.
  3. An admin records `provider_verified` with a note.
  4. An admin records `not_required` with a reason.

  This matches the Catalogue's statement that a training event cannot be published without an explicit site-coverage decision.

### Q4 — Authorisation for composite shifts · **AGREED 16 Oct 2026: yes — primary duty AND every restricted included responsibility need their own valid authorisation**
`site_lead`, `open_unlock` and `lock_secure` default to `requires_authorisation=true`.
**Proposed:** To take a shift, a volunteer needs a valid authorisation for the primary duty **and** for every included responsibility that requires one. For example, a composite site lead with unlock and lock needs all three authorisations.
**Alternative:** require only a `site_lead` authorisation and treat it as implying the keyholder roles. This is simpler to administer, but it implies that every site lead is a keyholder.

### Q5 — "Required window" for an event linked to venue cover · **AGREED 16 Oct 2026: earliest setup start to end of cleaning (union of event times and all its active shifts)**
The Catalogue says linked cover must span "the relevant operational window" but does not define it.
**Proposed:** The required window is the earliest start to the latest end of the union of two sets of intervals:
- the linked event's own `starts_at`/`ends_at`;
- all of its active shifts, so that setup before kickoff and cleaning afterwards are also covered.

For the Catalogue §6 example, the youth block is 09:00–12:00, setup starts at 08:15 and cleaning ends at 12:30. The required window is therefore 08:15–12:30, which is inside the coverage event's 08:00–14:00, so it is covered.

### Q6 — Restricted duties: hard gate or approval · PROPOSED
**Proposed:** The authorisation check is a hard eligibility gate. A volunteer without a valid authorisation cannot sign up or accept, and the shift is shown as "Needs club authorisation". `approval_required` is a separate per-shift setting, defaulting to **false** for all seeded items. An admin can switch it on, for example for gate and cash duties.

### Q7 — Email provider · PROPOSED (needed before Phase 6)
Any transactional API that supports idempotency keys and a verified sending domain will work. Postmark, Resend and Amazon SES are all suitable. The club needs a domain it controls, and must also decide the sending address, for example `rota@<club domain>`.

### Q8 — Schema additions (build-progress §4) · PROPOSED
These add the following columns. The rationale for each is in build-progress §4.
- template items: `instructions`, `suppressed_by_linked_cover`, `sort_order`
- template: `code`, `description`
- events: `instructions`, `site_responsibility`, `is_demo`
- volunteers: `preferred_venue_id`
- assignments: `removal_reason`, `status_changed_at`
- shifts: `source_template_item_id`

### Q9 — Template ↔ event type and venue · PROPOSED
| Template | event_type | venue |
|---|---|---|
| T01, T02 | fixture | Marke Wood |
| T03, T04 | fixture | Freemens Way |
| T05 | training | any |
| T06, T09 | venue_coverage | any |
| T07 | club_event (also offered for `fundraising` and `meeting`) | any |
| T08 | maintenance | any |

A venue-specific template is only offered for events at that venue.

### Q10 — Coordinator visibility · PROPOSED
- Coordinators can see **draft** events at their venues only.
- They can see email and phone only for volunteers with an active assignment, meaning `invited`, `pending_approval` or `confirmed`, on their venues' events, plus a name-only picker of all active volunteers so that they can allocate.
- Volunteers never see drafts.

## Phase 1 decisions (16 Oct 2026)

- **D-101 Versions.** Next.js 16.4.2, React 19.3, @supabase/ssr 0.12.7, @supabase/supabase-js 2.118, zod 4.6, Tailwind 4.3 and Vitest 5. TypeScript 5.9 and ESLint 9 are kept because they are the versions `create-next-app` 16.4 pairs with Next.js. They will be upgraded only when Next supports TS 7 and ESLint 10.
- **D-102 Cache Components on, identity never cached.** Next 16 enables Cache Components, and the docs say it becomes mandatory in the next major release. Session and role reads are deliberately **not** wrapped in `use cache: private`, because that would let a suspended account keep cached access for up to 5 minutes. Each protected page reads the session inside a `<Suspense>` boundary on every request.
- **D-103 Authorisation location.** Layouts are static chrome only, because they don't re-run on client navigation. Every protected page and every Server Action or Route Handler calls the DAL (`requireVolunteer` / `requireRole`). `proxy.ts` (Next 16's renamed middleware) only refreshes the session and makes an optimistic redirect to /login. RLS is the final barrier.
- **D-104 Sign-in method.** The primary method is a 6-digit emailed code, which is more reliable on phones where email apps open links in a different browser. The emailed link (`/auth/callback?token_hash=…`) is also supported. Sign-up is impossible: `shouldCreateUser:false` is set, and public sign-ups are disabled in the dashboard.
- **D-105 Account linking.** `link_volunteer_account()` takes no arguments. It uses only `auth.uid()` and the Auth-held verified email, matched case-insensitively. It requires `invited_at` and `is_active`, and it never re-points a row that is already linked.
- **D-106 Supabase key naming.** The app uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`, following Supabase's current naming. Legacy anon and service_role keys work in the same variables.
- **D-107 Bootstrap invites.** Until the Phase 5 volunteer screen exists, admins are invited with `scripts/invite-volunteer.mts` on a trusted machine.
- **D-108 Branding.** The navy and amber colours and the "CP" text mark are **placeholders** pending the club's official colours and crest. They are changed in one place: `src/app/globals.css` and `src/components/club-mark.tsx`.
- **D-109 Login rate-limiting.** This relies on Supabase Auth's built-in OTP limits (per address and per IP) for Phase 1. App-level limits for signup writes are added with the RPCs in Phase 2.
