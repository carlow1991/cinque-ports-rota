# Retired end-to-end checks (template rota)

These scripts tested the pre-Hub rota screens (templates, shifts, approvals, coverage). Those screens are
retired from normal use by the Volunteer Hub (they redirect unless `LEGACY_ROTA_UI=true`, and several of
their URLs — `/manage`, `/manage/events/*` — now belong to the Hub). They are kept for reference only
and are not part of `npm run e2e`. The rota's email worker, cron endpoint and security headers that
`phase6-email.mts` covered are exercised by `../hub-demo.mts` and the database tests.
