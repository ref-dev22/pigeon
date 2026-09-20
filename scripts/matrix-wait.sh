#!/bin/bash
# wait until no watch on the board is mid-check (checkingSince set) and every page has 2+ checks or is paused
B="$1"
for i in $(seq 1 60); do
  out=$(npx convex run --prod admin:boardReport "{\"boardId\":\"$B\"}" 2>/dev/null)
  done_count=$(echo "$out" | grep -c '"checks": [2-9]')
  if [ "$done_count" -ge 22 ]; then echo "all rechecked"; exit 0; fi
  sleep 15
done
echo "timeout: $done_count rechecked"
