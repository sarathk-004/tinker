#!/usr/bin/env bash
# Fresh-install verification (acceptance A31): clone the repository into an empty folder and follow the documented procedure
# (docs/runbook.md section 1) with NO local files, secrets or state from your working copy. Uses its own ports and database.
#   bash scripts/fresh-setup-check.sh [branch]        takes several minutes (npm ci downloads packages)
# Exit code 0 only if every step passed. The temporary clone is deleted at the end.
set -u
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
DB_PORT=54341
API_PORT=8791
FAILED=0
step() { printf '\n== %s\n' "$1"; }
ok() { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
cleanup() {
  [ -n "${API_PID:-}" ] && taskkill //PID "$API_PID" //T //F >/dev/null 2>&1
  [ -n "${DB_PID:-}" ] && taskkill //PID "$DB_PID" //T //F >/dev/null 2>&1
  sleep 4 # let Windows release the database files
  cd "$SRC" && rm -rf "$WORK" 2>/dev/null || echo "(temporary folder $WORK could not be removed yet; it is safe to delete by hand)"
}
trap cleanup EXIT

step "clone $BRANCH into an empty folder"
git clone --quiet --branch "$BRANCH" "$SRC" "$WORK/tinker" && ok "cloned" || { bad "clone"; exit 1; }
cd "$WORK/tinker" || exit 1
[ ! -f server/.env ] && [ ! -f .env ] && ok "no .env files came with the clone (nothing local is being reused)" || bad "unexpected .env in the clone"

step "npm ci"
npm ci --no-audit --no-fund >"$WORK/ci.log" 2>&1 && ok "npm ci" || { bad "npm ci (see $WORK/ci.log)"; tail -20 "$WORK/ci.log"; exit 1; }

step "typecheck, tests, boundaries, build, artifact scan"
npm run typecheck >"$WORK/typecheck.log" 2>&1 && ok "typecheck" || { bad "typecheck"; tail -20 "$WORK/typecheck.log"; }
npm test >"$WORK/test.log" 2>&1 && ok "tests: $(grep -E 'Tests ' "$WORK/test.log" | tr -s ' ' | tr '\n' ';')" || { bad "tests"; tail -30 "$WORK/test.log"; }
npm run check:boundaries >/dev/null 2>&1 && ok "contract boundaries" || bad "contract boundaries"
npm run build >"$WORK/build.log" 2>&1 && ok "build" || { bad "build"; tail -20 "$WORK/build.log"; }
npm run check:artifacts 2>&1 | tail -1 | grep -q "passed" && ok "built frontend has no secrets" || bad "artifact scan"

step "database, migrations, API"
DEV_DB_PORT=$DB_PORT npm run dev:db -w @tinker/server >"$WORK/db.log" 2>&1 &
DB_PID=$!
for i in $(seq 1 60); do grep -q "Postgres ready" "$WORK/db.log" 2>/dev/null && break; sleep 1; done
grep -q "Postgres ready" "$WORK/db.log" && ok "local database started" || { bad "database did not start"; tail "$WORK/db.log"; exit 1; }
export DATABASE_URL="postgres://tinker:tinker@localhost:$DB_PORT/tinker"
npm run db:migrate -w @tinker/server >"$WORK/migrate.log" 2>&1 && ok "migrations applied ($(grep -c 'MIGRATION' "$WORK/migrate.log") steps)" || { bad "migrations"; tail "$WORK/migrate.log"; exit 1; }
NODE_ENV=development AUTH_MODE=dev PORT=$API_PORT CORS_ORIGINS=http://localhost:5173 LOG_LEVEL=warn npm run start -w @tinker/server >"$WORK/api.log" 2>&1 &
API_PID=$!
for i in $(seq 1 60); do curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 && break; sleep 1; done
curl -sf "http://127.0.0.1:$API_PORT/health/ready" >/dev/null && ok "API is up and the database is reachable" || { bad "API did not start"; tail "$WORK/api.log"; exit 1; }

step "critical path"
API_URL="http://127.0.0.1:$API_PORT" npm run smoke:api -w @tinker/server >"$WORK/smoke.log" 2>&1 && ok "smoke check: $(grep -c '^PASS' "$WORK/smoke.log") steps passed" || { bad "smoke check"; grep -E '^FAIL' "$WORK/smoke.log"; tail -5 "$WORK/smoke.log"; }
DATABASE_URL="$DATABASE_URL" npm run backup:drill -w @tinker/server >"$WORK/drill.log" 2>&1 && ok "backup and restore drill ($(grep -E '^verify' "$WORK/drill.log" | cut -c1-90))" || { bad "backup drill"; tail -5 "$WORK/drill.log"; }
npm run worker -w @tinker/server >"$WORK/worker.log" 2>&1 &
WORKER_PID=$!
sleep 12
taskkill //PID "$WORKER_PID" //T //F >/dev/null 2>&1
grep -q '"job completed"' "$WORK/worker.log" && ok "worker scheduled and completed its jobs" || { bad "worker"; tail -5 "$WORK/worker.log"; }

echo
[ "$FAILED" = 0 ] && echo "Fresh setup check passed." || echo "Fresh setup check FAILED."
exit $FAILED
