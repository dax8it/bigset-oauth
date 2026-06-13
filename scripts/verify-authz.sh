#!/usr/bin/env bash
# Verifies BigSet's authorization layer end-to-end against a running local
# stack (frontend :3500, convex :3210). Exits 0 if everything passes,
# 1 if any check fails. Designed to be safe to rerun.
#
#   bash scripts/verify-authz.sh
set -u

CONVEX="${CONVEX_URL:-http://localhost:3210}"
FRONTEND="${FRONTEND_URL:-http://localhost:3500}"
FAIL=0
LOCAL_DEV_MODE=0

run_test() {
  local label="$1"
  local result="$2"
  if [ "$result" = "PASS" ]; then
    printf "  ✓ %-66s %s\n" "$label" "PASS"
  else
    printf "  ✗ %-66s %s\n" "$label" "$result"
    FAIL=1
  fi
}

section() {
  echo ""
  echo "── $1 ──────────────────────────────────────────────────────────"
}

json_payload() {
  local path="$1"
  local args_json="{}"
  if [ "$#" -ge 2 ]; then
    args_json="$2"
  fi
  python3 - "$path" "$args_json" <<'PY'
import json, sys
path = sys.argv[1]
args = json.loads(sys.argv[2])
print(json.dumps({"path": path, "args": args, "format": "json"}, separators=(",", ":")))
PY
}

convex_call() {
  local kind="$1"
  local path="$2"
  local args_json="{}"
  if [ "$#" -ge 3 ]; then
    args_json="$3"
  fi
  local payload
  payload="$(json_payload "$path" "$args_json")"
  curl -s "$CONVEX/api/$kind" -X POST -H 'Content-Type: application/json' -d "$payload"
}

query() {
  if [ "$#" -ge 2 ]; then
    convex_call query "$1" "$2"
  else
    convex_call query "$1"
  fi
}

mutation() {
  if [ "$#" -ge 2 ]; then
    convex_call mutation "$1" "$2"
  else
    convex_call mutation "$1"
  fi
}

json_arg_id() {
  python3 - "$1" <<'PY'
import json, sys
print(json.dumps({"id": sys.argv[1]}, separators=(",", ":")))
PY
}

json_arg_public_dataset_id() {
  python3 - "$1" <<'PY'
import json, sys
print(json.dumps({"datasetId": sys.argv[1]}, separators=(",", ":")))
PY
}

json_arg_update_status() {
  python3 - "$1" <<'PY'
import json, sys
print(json.dumps({"id": sys.argv[1], "status": "paused"}, separators=(",", ":")))
PY
}

json_get_first_public_id() {
  python3 -c 'import json,sys
try:
    d=json.load(sys.stdin); value=d.get("value") or []; print(value[0]["_id"] if value else "")
except Exception:
    print("")'
}

json_get_status() {
  python3 -c 'import json,sys
try:
    print(json.load(sys.stdin).get("status", "?"))
except Exception:
    print("?")'
}

json_get_value_string() {
  python3 -c 'import json,sys
try:
    value=json.load(sys.stdin).get("value"); print(value if isinstance(value, str) else "")
except Exception:
    print("")'
}

assert_success() {
  python3 -c 'import json,sys
try:
    d=json.load(sys.stdin)
except Exception as exc:
    print(f"FAIL: invalid JSON: {exc}"); raise SystemExit(0)
print("PASS" if d.get("status") == "success" else "FAIL: " + (d.get("errorMessage") or "?")[:80])'
}

assert_error_contains() {
  local needle="$1"
  python3 -c 'import json,sys
needle=sys.argv[1]
try:
    d=json.load(sys.stdin)
except Exception as exc:
    print(f"FAIL: invalid JSON: {exc}"); raise SystemExit(0)
msg=d.get("errorMessage") or ""
print("PASS" if needle in msg else "FAIL: " + (msg or "?")[:100])' "$needle"
}

echo "════════════════════════════════════════════════════════════════"
echo "  BigSet authorization verification"
echo "  convex=$CONVEX  frontend=$FRONTEND"
echo "════════════════════════════════════════════════════════════════"

PUB_ID="$(query "datasets:listPublic" | json_get_first_public_id)"
if [ -z "${PUB_ID:-}" ]; then
  echo "No public dataset found. Seed curated data first (publicSeed:seedPublicDatasets)."
  exit 1
fi

section "Anonymous READ — public dataset must be accessible"
run_test "anon datasets.get(public)" \
  "$(query "datasets:get" "$(json_arg_id "$PUB_ID")" | assert_success)"
run_test "anon datasetRows.listByDataset(public)" \
  "$(query "datasetRows:listByDataset" "$(json_arg_public_dataset_id "$PUB_ID")" | assert_success)"
run_test "anon datasets.listPublic" \
  "$(query "datasets:listPublic" | assert_success)"

section "Anonymous WRITES — rejected (Clerk mode) or scoped to local dev user (BIGSET_LOCAL_MODE=1)"

# authz.ts's requireIdentity() substitutes a synthetic "local_user_default"
# identity for unauthenticated callers when BIGSET_LOCAL_MODE=1 (see
# frontend/convex/lib/authz.ts), so anonymous writes don't throw
# "Not authenticated" in local mode — they succeed as that shared local user.
# Detect which mode we're in from the listMine response itself and assert
# the invariant that actually applies to each mode.
LISTMINE_RESULT="$(query "datasets:listMine")"
LISTMINE_STATUS="$(echo "$LISTMINE_RESULT" | json_get_status)"

if [ "$LISTMINE_STATUS" = "success" ]; then
  LOCAL_DEV_MODE=1
  echo "  (BIGSET_LOCAL_MODE=1 detected — anonymous callers are the shared local dev user)"

  run_test "anon datasets.listMine -> success (local dev user)" \
    "$(echo "$LISTMINE_RESULT" | assert_success)"

  CREATE_ARGS='{"name":"verify-authz-tmp","description":"tmp dataset from verify-authz.sh","refreshCadence":"manual","maxRowCount":1,"columns":[]}'
  CREATE_RESULT="$(mutation "datasets:create" "$CREATE_ARGS")"
  run_test "anon datasets.create -> success (local dev user)" \
    "$(echo "$CREATE_RESULT" | assert_success)"
  TMP_ID="$(echo "$CREATE_RESULT" | json_get_value_string)"
  if [ -n "${TMP_ID:-}" ]; then
    run_test "cleanup: remove local-user test dataset" \
      "$(mutation "datasets:remove" "$(json_arg_id "$TMP_ID")" | assert_success)"
  else
    echo "  (skipped cleanup — could not read created dataset id from response)"
  fi

  run_test "anon datasets.updateStatus(system dataset) -> Dataset not found" \
    "$(mutation "datasets:updateStatus" "$(json_arg_update_status "$PUB_ID")" | assert_error_contains 'Dataset not found')"
  run_test "anon datasets.remove(system dataset) -> Dataset not found" \
    "$(mutation "datasets:remove" "$(json_arg_id "$PUB_ID")" | assert_error_contains 'Dataset not found')"
else
  run_test "anon datasets.listMine -> Not authenticated" \
    "$(echo "$LISTMINE_RESULT" | assert_error_contains 'Not authenticated')"
  run_test "anon datasets.create -> Not authenticated" \
    "$(mutation "datasets:create" '{"name":"x","description":"x","refreshCadence":"manual","maxRowCount":1,"columns":[]}' | assert_error_contains 'Not authenticated')"
  run_test "anon datasets.updateStatus -> Not authenticated" \
    "$(mutation "datasets:updateStatus" "$(json_arg_update_status "$PUB_ID")" | assert_error_contains 'Not authenticated')"
  run_test "anon datasets.remove -> Not authenticated" \
    "$(mutation "datasets:remove" "$(json_arg_id "$PUB_ID")" | assert_error_contains 'Not authenticated')"
fi

section "Internal mutations — must not be HTTP-callable"
for fn in insert update remove; do
  run_test "datasetRows.$fn is internal" \
    "$(mutation "datasetRows:$fn" | assert_error_contains 'Could not find public function')"
done
run_test "publicSeed.seedPublicDatasets is internal" \
  "$(mutation "publicSeed:seedPublicDatasets" | assert_error_contains 'Could not find public function')"

section "HTTP route protection"
run_test "GET /                         -> 200" \
  "$([ "$(curl -s -o /dev/null -w '%{http_code}' "$FRONTEND/")" = "200" ] && echo PASS || echo FAIL)"
run_test "GET /dataset/<public>         -> 200" \
  "$([ "$(curl -s -o /dev/null -w '%{http_code}' "$FRONTEND/dataset/$PUB_ID")" = "200" ] && echo PASS || echo FAIL)"
run_test "GET /sign-in                  -> 200" \
  "$([ "$(curl -s -o /dev/null -w '%{http_code}' "$FRONTEND/sign-in")" = "200" ] && echo PASS || echo FAIL)"
if [ "$LOCAL_DEV_MODE" = "1" ]; then
  echo "  (local frontend mode detected — Clerk proxy is intentionally disabled)"
  run_test "GET /dashboard (local anon)   -> 200" \
    "$([ "$(curl -s -o /dev/null -w '%{http_code}' "$FRONTEND/dashboard")" = "200" ] && echo PASS || echo FAIL)"
  run_test "GET /dataset/new (local anon) -> 200" \
    "$([ "$(curl -s -o /dev/null -w '%{http_code}' "$FRONTEND/dataset/new")" = "200" ] && echo PASS || echo FAIL)"
else
  run_test "GET /dashboard (anon)         -> 307" \
    "$([ "$(curl -s -o /dev/null -w '%{http_code}' "$FRONTEND/dashboard")" = "307" ] && echo PASS || echo FAIL)"
  run_test "GET /dataset/new (anon)       -> 307" \
    "$([ "$(curl -s -o /dev/null -w '%{http_code}' "$FRONTEND/dataset/new")" = "307" ] && echo PASS || echo FAIL)"
fi

echo ""
if [ "$FAIL" = "0" ]; then
  echo "════════════════════════════════════════════════════════════════"
  echo "  ALL CHECKS PASSED ✓"
  echo "════════════════════════════════════════════════════════════════"
  exit 0
else
  echo "════════════════════════════════════════════════════════════════"
  echo "  SOME CHECKS FAILED ✗"
  echo "════════════════════════════════════════════════════════════════"
  exit 1
fi
