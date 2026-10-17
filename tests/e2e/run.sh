#!/usr/bin/env bash
# Run an end-to-end check script against a FRESH test database.
#   tests/e2e/run.sh tests/e2e/phase4-volunteer.mts [--build]
# Requires a local PostgreSQL on port 54329 (see TEST_PG_ADMIN_URL). Uses the test-only fake
# Supabase on 127.0.0.1:54399 and the production build on :3200. Never touches a real project.
set -euo pipefail
cd "$(dirname "$0")/../.."
SCRIPT="${1:?usage: tests/e2e/run.sh <check script> [--build]}"
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test
export NEXT_PUBLIC_SITE_URL=http://localhost:3200
export NEXT_TELEMETRY_DISABLED=1
# Test-only secret for the fake server; invitations are "sent" to the fake, never by email.
export SUPABASE_SECRET_KEY=sb_secret_test
export AUTH_INVITES_ENABLED=true

stop_port() { if command -v fuser >/dev/null; then fuser -k "$1/tcp" >/dev/null 2>&1 || true; fi; }

stop_port 54399
DB_URL="$(node tests/e2e/support/setup-db.mts rota_e2e | tail -1)"
node tests/e2e/support/fake-supabase.mts --db "$DB_URL" --port 54399 > test-results/fake-supabase.log 2>&1 &
for _ in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:54399/auth/v1/.well-known/jwks.json && break; sleep 0.5; done

if [[ "${2:-}" == "--build" ]] || ! curl -s -o /dev/null http://localhost:3200/login; then
  stop_port 3200
  [[ "${2:-}" == "--build" || ! -d .next ]] && npx next build > test-results/next-build.log 2>&1
  npx next start -p 3200 > test-results/next-server.log 2>&1 &
  for _ in $(seq 1 60); do curl -s -o /dev/null http://localhost:3200/login && break; sleep 0.5; done
fi

APP_URL=http://localhost:3200 DB_URL="$DB_URL" node "$SCRIPT"
