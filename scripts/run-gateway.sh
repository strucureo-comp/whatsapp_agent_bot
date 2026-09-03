#!/usr/bin/env bash
# Run the WhatsApp gateway under a restart loop, tee'd to gateway.log.
#
# The gateway used to run bare in tmux: when it died, nothing stayed on screen and
# nothing was written to disk, so the only symptom was the daemon reporting
# "cannot reach gateway at http://127.0.0.1:8080 — fetch failed" with no way to
# recover the cause. Everything here exists to make the next failure explainable.
#
# Rebuilding each iteration is deliberate — in dev, fixing the code and letting the
# loop pick it up is the fast path.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${GATEWAY_LOG:-$ROOT/gateway.log}"

cd "$ROOT/services/gateway" || exit 1
mkdir -p bin

stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

attempt=0
while :; do
  printf '\n=== gateway build+start %s ===\n' "$(stamp)" | tee -a "$LOG"

  if go build -o bin/gateway ./cmd/gateway 2>&1 | tee -a "$LOG"; then
    ./bin/gateway 2>&1 | tee -a "$LOG"
    status=${PIPESTATUS[0]}

    # 0 is a graceful shutdown (SIGINT/SIGTERM handled in main). Restarting after
    # that would fight the operator who just stopped it.
    if [ "$status" -eq 0 ]; then
      echo "gateway: exited cleanly at $(stamp)" | tee -a "$LOG"
      exit 0
    fi

    attempt=$((attempt + 1))
    echo "gateway: exited with status $status at $(stamp) — restart #$attempt in 2s" | tee -a "$LOG"
    sleep 2
  else
    echo "gateway: build failed at $(stamp) — retrying in 5s" | tee -a "$LOG"
    sleep 5
  fi
done
