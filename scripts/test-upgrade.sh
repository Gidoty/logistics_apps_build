#!/usr/bin/env bash
# Checks the upgrade path for a project that already ran Batches 1 to 3 with the
# seed of that time: apply those migrations and that seed, then the Batch 4
# migration, then today's seed twice. Fails if any step errors or the result is
# not what the pricing engine needs. Uses a throwaway local Postgres (no Docker).
#   npm run test:upgrade
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)}"
[[ -x "$PG_BIN/initdb" ]] || PG_BIN="$(dirname "$(command -v initdb || echo /nonexistent/initdb)")"
[[ -x "$PG_BIN/initdb" ]] || { echo "initdb not found. Set PG_BIN." >&2; exit 1; }

PORT="${TEST_DB_PORT:-55433}"
DATA_DIR="$(mktemp -d)"
RUN_AS=()
if [[ "$(id -u)" == "0" ]]; then chown postgres "$DATA_DIR"; RUN_AS=(runuser -u postgres --); fi
cleanup() { "${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$DATA_DIR" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA_DIR"; }
trap cleanup EXIT

"${RUN_AS[@]}" "$PG_BIN/initdb" -D "$DATA_DIR" -U postgres --auth=trust >/dev/null
"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$DATA_DIR" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -l "$DATA_DIR/log" -w start >/dev/null
URL="postgresql://postgres@127.0.0.1:$PORT/postgres"
run() { psql "$URL" -v ON_ERROR_STOP=1 -q "$@" 2>&1 | grep -v NOTICE || true; }
check() { psql "$URL" -At -c "$1"; }

run -f "$ROOT/tests/db/supabase-stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  case "$(basename "$f")" in 20261015*) ;; *) run -f "$f" ;; esac
done
psql "$URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/tests/db/fixtures/seed-batch3.sql"
[[ "$(check "select count(*) from public.fee_rules")" == "7" ]] || { echo "old seed not as expected" >&2; exit 1; }

echo "Applying the Batch 4 migration to a project seeded the old way"
psql "$URL" -v ON_ERROR_STOP=1 -q -f "$ROOT"/supabase/migrations/20261015*.sql
echo "Applying today's seed twice"
psql "$URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/seed.sql"
psql "$URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/seed.sql"

open_rules="$(check "select count(*) from public.fee_rules where effective_to is null")"
closed_rules="$(check "select count(*) from public.fee_rules where effective_to is not null")"
# Open: the two old service fees and the old clearing rule stay; everything else is the new seed.
# Closed: the old un-banded freight rule and the two old un-zoned last-mile rules.
[[ "$closed_rules" == "3" ]] || { echo "expected 3 closed legacy rules, got $closed_rules" >&2; exit 1; }
[[ "$(check "select count(*) from public.fee_rules where effective_to is null and fee_type = 'international_freight' and weight_from_g is not null")" == "3" ]] || { echo "freight bands missing" >&2; exit 1; }
[[ "$(check "select count(*) from public.fee_rules where effective_to is null and fee_type = 'last_mile' and zone_id is null")" == "0" ]] || { echo "an un-zoned last-mile rule is still open" >&2; exit 1; }
[[ "$(check "select import_duty_percent from public.duty_rates where category_slug is null")" == "10.0000" ]] || { echo "old customs estimate not carried over" >&2; exit 1; }
[[ "$(check "select count(*) from public.duty_rates")" == "3" ]] || { echo "duty rates not as expected" >&2; exit 1; }
echo "Upgrade path OK ($open_rules open rules, $closed_rules closed)"
