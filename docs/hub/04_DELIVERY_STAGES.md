# 04 — Claude Code Implementation Stages

The prompt below is meant for Claude Code **inside the existing repository**. Do not execute all production changes without approval. Each stage should build tested real functionality, not dead-end mockups. State assumptions and produce a short, meaningful handover after each stage.

## Stage 0 — Repository, UX and migration audit (no code changes)
**Paste:**
> Read all docs and inspect the entire current application, not just login. Identify framework/version, pages, current data-entry pain, old duty/shift wizards, auth flows, RLS, Supabase tables, migrations, event/calendar implementation, assignment states, email triggers, deployment setup and test coverage. Compare current implementation with new Volunteer Hub specs. Report (1) reuse vs retire, (2) migration and data preservation strategy, (3) permission gaps, (4) precise stages and files, (5) risks, (6) decisions that truly require owner approval. Do not modify production or send emails.

**Exit:** current functionality inventory; route map and feature flags; zero-data-loss migration outline; tests to add; no unchecked assertion about unavailable data.

## Stage 1 — App shell, people and auth decoupling
**Paste:**
> Implement the new minimal navigation and people-first domain model on a feature branch. Migrate/bridge existing volunteer records without duplicate people; support person with name only, optional auth_user_id, independent `routine_requests_enabled`, and separate explicit `Send portal invite` action. Create admin Add/Edit Person and People Directory, team memberships, team officials expected by role. Set demo/test fixtures only in development; no real invitations. Run schema/RLS tests, lint, typecheck, build. Show screenshots/test results and list any data mapping ambiguity.

**Exit:** login remains secure; person saved without email and without sending any notification; Scott/Danny/Matty-style official can be recorded with expected flag and no routine prompts; field-level visibility tested.

## Stage 2 — Unified calendar and minimal event form
**Paste:**
> Build one club calendar for every event type, including away/other-location and information-only events. Default agenda/day grouping, clean mobile cards and filters. Build quick Create Event with minimum event details and optional `Ask volunteers for availability`. Support overlapping fixtures, dates with unknown end, kickoff distinct from coverage start, simple duplication, draft/publish/cancel. Marke Wood active; Freemens Way inactive and preserved. Remove mandatory duty-template wizard from this flow. Test venue filtering, overlap layout, date localisation/DST, create/update/cancel and migrated records.

**Exit:** admin can create an information-only away event with no volunteer workflow; three overlapping fixtures at Marke Wood display separately; Freemens Way history remains, but new normal event form excludes inactive venue.

## Stage 3 — Event responses, targeted invitations and confirmed assignments
**Paste:**
> Implement event Yes/No availability with Full Event / Specific Times when relevant; only targeted invitees show 'Not replied'; log admin-recorded offline responses separately from person-submitted ones. Implement direct assignment requests with pending/confirmed/declined/cancelled and accept/decline UX; allow one-off invites to people who do not receive routine requests. Ensure explicit send confirmation and no notifications simply for adding people/events. Show derived expected-by-role officials on team events as neutral expected, not confirmed. Add permission/security and mutation tests, then run all checks.

**Exit:** Kelly can say Yes 09:00–13:00; Bob can confirm a Ladies fixture; Steve can decline; manager is expected without being auto-invited; information-only event never asks for Yes/No.

## Stage 4 — Shared venue coverage and weekend overview
**Paste:**
> Implement one venue-wide assignment per actual duty/person/time, separate from events. Show confirmed shared cover as one venue/day strip and as *derived contextual coverage* for every overlapping event; never copy event assignments. Include partial-coverage labels and unknown-duration safeguards. Create admin venue-cover entry and confirmation/decline. Warn on genuinely incompatible overlap while permitting same-site shared coverage. Build 'This weekend' overview of events, expected officials, offers, pending invitations, confirmed event responsibilities and shared venue cover. Test three concurrent events with one café shift, changes/cancellation and distinct headcounts.

**Exit:** Kelly's one café duty appears correctly across Mini Kickers, youth fixtures and Veterans, but counted as one person; cancelling cover immediately removes derived context.

## Stage 5 — Club positions, occupancy, recruitment and succession
**Paste:**
> Build Club Positions area with many-to-many holders, history, responsibilities, department, estimated commitment, training and publishing settings. **Occupancy and recruitment are independent**: support Filled + Seeking replacement, Filled + Additional help, both flags together, and Vacant + Advertised. Provide member directory and limited public opportunity pages. Add register-interest CTA and lightweight succession stages (interest, discussion, shadowing, handover). Never alter an external official club/FA appointment through UI. Test multi-role person, joint holders, historical handover and privacy.

**Exit:** one person holds secretary, finance and grounds roles; each filled role independently advertises a successor; no public private contact data.

## Stage 6 — Public volunteer questionnaire and application inbox
**Paste:**
> Build public `/volunteer/apply` in 3 mobile-friendly steps, no login, adult suitability/under-18 guidance, contacts, role interests, strengths, learning/shadowing, weekly daypart availability, commitment level and privacy acknowledgement. Submit through protected server endpoint with validation, spam/rate controls and public-no-read security. Store as reviewable application; display in admin People > Applicants and Applications inbox. Detect potential duplicates for manual linking. Add transparent rules-based suggested roles without automated appointment. Explicit invite to portal is separate. Test anonymous public security, duplicate and application status workflow.

**Exit:** a complete anonymous application reaches admin review, private info never leaks, no automatic auth account created; applicant receives no portal invite.

## Stage 7 — Communication reliability, UX polish and deployment readiness
**Paste:**
> Add safe explicit email invitation/send flows, notification outbox/idempotency/retries, failure UX, event change/reconfirmation handling, privacy controls and export/deletion workflows as configured. Conduct mobile usability and accessibility review; remove old redundant rota navigation and mandatory duty-template UI behind a reversible feature flag. Finish migrations/rollback and all tests. Produce admin + volunteer guides, setup checklist, env template, privacy policy placeholders, deployment runbook, and documented remaining V1.1 enhancements. Do not deploy or send real emails until approved.

**Exit:** all critical acceptance tests pass in staging; logs audit actor/source; backup verified and rollback rehearsed; system suitable for owner review prior to launch.

## Required output from Claude after each stage
1. What was implemented, with changed files and migrations.
2. Screens/flows available and anything deliberately deferred.
3. Tests run (actual commands and results), with failing tests identified.
4. Security or data risks and how they were resolved.
5. Exact next stage and blockers requiring human input.

## Delivery discipline
- Stage 0 is audit-only. Preserve original live deployment throughout staged development.
- Use migrations as code and test with representative anonymised seed records. Never treat sample names/roles as proof of current official registered postholder or authorisation.
- For each requested migration, describe rollback or feature-flag revert first. Never DROP original tables without later explicit approval.
- Approved design constraints are authoritative: do not reintroduce role-by-role signup, compulsory nine-duty template picker, mandatory headcounts, shift quotas or complex supervisor approval matrix.
- If repository uses versions different from this plan, check installed package versions and use supported framework APIs rather than blindly upgrading everything.
