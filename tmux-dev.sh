#!/usr/bin/env bash
# Start Strucureo dev environment in tmux — all commands auto-run
SESSION="strucureo-dev"
ROOT="$(cd "$(dirname "$0")" && pwd)"

tmux has-session -t "$SESSION" 2>/dev/null
if [ $? -eq 0 ]; then
  tmux attach -t "$SESSION"
  exit 0
fi

# Window 0: infra — start postgres, redis, run migrations
tmux new-session -d -s "$SESSION" -n "infra" \
  "cd $ROOT && brew services start postgresql@14 2>/dev/null; brew services start redis 2>/dev/null; sleep 2; cd services/agent-daemon && pnpm exec tsx src/db/migrate.ts; echo ''; echo '✅ Infrastructure ready. Switch to gateway: Ctrl-b 1'; exec bash"

# Window 1: gateway
#
# run-gateway.sh restarts it on a crash and tees everything to gateway.log;
# remain-on-exit holds the pane open so a fatal exit stays readable instead of
# vanishing with the window.
tmux new-window -t "$SESSION" -n "gateway" \
  "$ROOT/scripts/run-gateway.sh; exec bash"
tmux set-option -w -t "$SESSION":gateway remain-on-exit on

# Window 2: daemon
tmux new-window -t "$SESSION" -n "daemon" \
  "cd $ROOT/services/agent-daemon && pnpm daemon; exec bash"

# Window 3: repl
tmux new-window -t "$SESSION" -n "repl" \
  "cd $ROOT/services/agent-daemon && pnpm repl; exec bash"

# Focus gateway (window 1) — infra is done
tmux select-window -t "$SESSION":gateway

tmux attach -t "$SESSION"
