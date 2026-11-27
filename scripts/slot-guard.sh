#!/bin/bash
# Slot guard: if the edition that should have posted in the last 45 minutes
# didn't actually appear on Instagram, dispatch the pipeline by hand.
#
# GitHub drops scheduled runs often enough that this is the difference between
# a late edition and a missing one. Runs four times a day from OpenClaw.
set -u

ROOT="/Users/madhavavarma/.openclaw/workspace"
LOG="$ROOT/pipeline/state/slot-guard.log"
mkdir -p "$(dirname "$LOG")"

say() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }

# Credentials
set -a
. "$ROOT/.secrets/meta.env"
set +a
GH_TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null | grep '^password=' | cut -d= -f2-)
[ -z "${GH_TOKEN:-}" ] && { say "no github token"; exit 0; }

# Which slot are we responsible for? Any slot that finished 70-200 minutes
# ago: GitHub delays runs by up to 50 minutes, so acting earlier than that
# would race the scheduler instead of covering for it.
SLOT=""
SLOT_AGE=0
NOW_EPOCH=$(date +%s)
for spec in "05:30 morning" "12:30 afternoon" "17:30 evening" "20:30 night"; do
  set -- $spec
  HHMM="$1"; NAME="$2"
  SLOT_EPOCH=$(TZ=Asia/Kolkata date -j -f "%Y-%m-%d %H:%M" "$(TZ=Asia/Kolkata date +%Y-%m-%d) $HHMM" +%s 2>/dev/null)
  [ -z "$SLOT_EPOCH" ] && continue
  AGE=$(( (NOW_EPOCH - SLOT_EPOCH) / 60 ))
  if [ "$AGE" -ge 70 ] && [ "$AGE" -le 200 ]; then SLOT="$NAME"; SLOT_AGE=$AGE; fi
done
[ -z "$SLOT" ] && exit 0

# Latest Instagram post
LAST=$(curl -s -m 25 \
  "https://graph.facebook.com/v21.0/${IG_USER_ID}/media?fields=timestamp&limit=1&access_token=${META_PAGE_TOKEN}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin).get("data",[]);print(d[0]["timestamp"] if d else "")' 2>/dev/null)

AGE_MIN=999
if [ -n "$LAST" ]; then
  AGE_MIN=$(python3 - "$LAST" <<'PY'
import sys, datetime
ts = sys.argv[1].replace('+0000','+00:00')
then = datetime.datetime.fromisoformat(ts)
now = datetime.datetime.now(datetime.timezone.utc)
print(int((now - then).total_seconds() // 60))
PY
)
fi

if [ "$AGE_MIN" -le "$SLOT_AGE" ]; then
  say "$SLOT ok — posted ${AGE_MIN}m ago, slot is ${SLOT_AGE}m old"
  exit 0
fi

say "$SLOT MISSING — last post ${AGE_MIN}m ago, dispatching"
curl -s -m 30 -X POST \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/informalbuff-cell/informalbuff-pipeline/actions/workflows/ingest.yml/dispatches" \
  -d '{"ref":"main"}' -o /dev/null -w '%{http_code}\n' >> "$LOG"
say "$SLOT dispatched"
