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

# Which slot just happened? Script is scheduled at :25 past each slot hour.
HOUR_IST=$(TZ=Asia/Kolkata date +%H)
case "$HOUR_IST" in
  05) SLOT="morning" ;;
  12) SLOT="afternoon" ;;
  17) SLOT="evening" ;;
  20) SLOT="night" ;;
  *)  SLOT="" ;;
esac
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

if [ "$AGE_MIN" -lt 50 ]; then
  say "$SLOT ok — last post ${AGE_MIN}m ago"
  exit 0
fi

say "$SLOT MISSING — last post ${AGE_MIN}m ago, dispatching"
curl -s -m 30 -X POST \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/informalbuff-cell/informalbuff-pipeline/actions/workflows/ingest.yml/dispatches" \
  -d '{"ref":"main"}' -o /dev/null -w '%{http_code}\n' >> "$LOG"
say "$SLOT dispatched"
