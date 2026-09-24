#!/usr/bin/env bash
# Starts a throwaway local Postgres (no Docker), applies a Supabase stand-in,
# all migrations and seed.sql, then runs the given command with DATABASE_URL
# set. The database is deleted afterwards.
#   scripts/with-test-db.sh npx vitest run tests/db
# Needs Postgres 15+ server binaries installed (initdb, pg_ctl).
# To test against the Supabase CLI stack instead:
#   npx supabase db reset   (applies migrations and seed.sql)
#   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run tests/db
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)}"
if [[ -z "$PG_BIN" || ! -x "$PG_BIN/initdb" ]]; then
  PG_BIN="$(dirname "$(command -v initdb || echo /nonexistent/initdb)")"
fi
if [[ ! -x "$PG_BIN/initdb" ]]; then
  echo "initdb not found. Set PG_BIN to your Postgres bin directory." >&2
  exit 1
fi

PORT="${TEST_DB_PORT:-55432}"
DATA_DIR="$(mktemp -d)"
RUN_AS=()
if [[ "$(id -u)" == "0" ]]; then
  # initdb refuses to run as root.
  chown postgres "$DATA_DIR"
  RUN_AS=(runuser -u postgres --)
fi

cleanup() {
  "${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$DATA_DIR" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

"${RUN_AS[@]}" "$PG_BIN/initdb" -D "$DATA_DIR" -U postgres --auth=trust >/dev/null
"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$DATA_DIR" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -l "$DATA_DIR/log" -w start >/dev/null

URL="postgresql://postgres@127.0.0.1:$PORT/postgres"
psql_run() { psql "$URL" -v ON_ERROR_STOP=1 -q "$@"; }

psql_run -f "$ROOT/tests/db/supabase-stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$f")"
  psql_run -f "$f"
done
echo "Applying seed.sql"
psql_run -f "$ROOT/supabase/seed.sql"
echo "Applying seed.sql again (must be a no-op)"
psql_run -f "$ROOT/supabase/seed.sql"

cd "$ROOT"
DATABASE_URL="$URL" "$@"
