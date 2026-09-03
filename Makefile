.PHONY: setup migrate clean-test-sessions dev daemon repl test typecheck logs psql redis-cli gateway gateway-build gateway-supervised gateway-log tmux dashboard dashboard-build prod-build prod-up prod-down prod-ps prod-logs prod-public-up

# ─── Setup ───────────────────────────────────────────────────────────────────
setup:
	pnpm install
	cd services/gateway && go mod download
	@echo "✅ Setup complete. Copy .env.example to .env and fill in values."

# ─── Database ────────────────────────────────────────────────────────────────
migrate:
	cd services/agent-daemon && pnpm db:migrate

clean-test-sessions:
	cd services/agent-daemon && pnpm db:clean

# ─── Development ─────────────────────────────────────────────────────────────
dev:
	docker compose up -d
	cd services/agent-daemon && pnpm dev

daemon:
	cd services/agent-daemon && pnpm daemon

repl:
	cd services/agent-daemon && pnpm repl

# ─── Gateway ─────────────────────────────────────────────────────────────────
# Foreground, no supervision — fine for a one-off run.
gateway:
	cd services/gateway && go run ./cmd/gateway

# Restart loop + gateway.log. This is what tmux-dev.sh runs, and the way to run it
# if you want the next crash to leave evidence behind.
gateway-supervised:
	./scripts/run-gateway.sh

# bin/gateway is the path systemd/strucureo-gateway.service execs.
gateway-build:
	cd services/gateway && mkdir -p bin && go build -o bin/gateway ./cmd/gateway
	@echo "✅ Built services/gateway/bin/gateway"

gateway-log:
	tail -f gateway.log

# ─── Testing ─────────────────────────────────────────────────────────────────
test:
	cd services/agent-daemon && pnpm test

typecheck:
	cd services/agent-daemon && pnpm typecheck
	cd services/gateway && go vet ./...

# ─── Utilities ───────────────────────────────────────────────────────────────
logs:
	docker compose logs -f

psql:
	docker compose exec postgres psql -U strucureo -d strucureo

redis-cli:
	docker compose exec redis redis-cli

# ─── Dashboard ───────────────────────────────────────────────────────────────
dashboard:
	cd services/dashboard && pnpm dev --port 3000

dashboard-build:
	cd services/dashboard && pnpm build

# ─── Production (Lightsail 2C/2GB — see DEPLOY.md) ───────────────────────────
prod-build:
	docker compose -f docker-compose.prod.yml build

prod-up:
	docker compose -f docker-compose.prod.yml up -d

prod-down:
	docker compose -f docker-compose.prod.yml down

prod-ps:
	docker compose -f docker-compose.prod.yml ps && docker stats --no-stream

prod-logs:
	docker compose -f docker-compose.prod.yml logs -f

prod-public-up:
	docker compose -f docker-compose.prod.yml --profile public up -d

# ─── Tmux ────────────────────────────────────────────────────────────────────
tmux:
	./tmux-dev.sh
