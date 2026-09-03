# Strucureo — production deploy

Target: **Lightsail 2 CPU / 2 GB** for gateway + daemon + Postgres + Redis.
Dashboard goes on **Vercel**. Auth is **Firebase** (`whatsappagentcrm`).

## 0. Decisions (do these first)

1. **Postgres location.** Recommended: managed Postgres (Neon/Supabase, pgvector
   available) — Vercel reaches it with zero firewall work, backups included.
   Point `DATABASE_URL`/`DIRECT_DATABASE_URL` at it in **both** `.env.prod`
   (daemon) and Vercel env (dashboard). Fallback: Lightsail-local Postgres from
   `docker-compose.prod.yml`, exposed with TLS + security-group IP rules.
2. **Gateway reachability.** The Vercel dashboard calls the gateway for
   pairing/status. Either expose it via the `public` Caddy profile on
   `https://gateway.strucureo.com` (DNS → Lightsail IP), or skip remote
   pairing and pair from an SSH tunnel.
3. **Google OAuth redirect.** Production value is the Vercel URL:
   `https://<app>.vercel.app/api/auth/google/callback` — add it in Google
   Console → Credentials → Authorized redirect URIs (localhost entry stays
   for dev), and set `GOOGLE_REDIRECT_URI` to match in Vercel env.

## 1. Server prep (Ubuntu)

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER  # re-login after

# 2 GB swap (box has 2 GB RAM — swap saves you during builds/backups)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Firewall: SSH only (add 80/443 only with --profile public)
sudo ufw allow 22/tcp && sudo ufw --force enable
```

## 2. Ship the code + secrets

```bash
git clone <repo> && cd whatsapp_agent
cp .env.prod.example .env.prod
# fill: POSTGRES_PASSWORD, GATEWAY_SECRET (openssl rand -hex 32),
# GROQ_API_KEY and/or ANTHROPIC_API_KEY, GOOGLE_CLIENT_ID/SECRET,
# GOOGLE_REDIRECT_URI=<vercel callback>
```

## 3. Launch

```bash
make prod-build
make prod-up        # postgres → redis → gateway → daemon (migrate runs automatically)
make prod-logs      # watch; Ctrl-C to detach from logs only
```

Pair WhatsApp: dashboard → WhatsApp tab (needs §0.2), or SSH + REPL.

```bash
make prod-ps         # container + memory check (all mem limits ≈ 1.8 GB caps)
make prod-down       # stop (data stays in volumes)
```

## 4. Vercel (dashboard)

Root directory: `services/dashboard`. Build: `pnpm build`. Env:

| Var | Value |
|---|---|
| `DATABASE_URL` / `DIRECT_DATABASE_URL` | pooled PG string (managed PG recommended) |
| `GATEWAY_URL` | `https://gateway.strucureo.com` (or tunnel) |
| `GATEWAY_SECRET` | same as `.env.prod` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | same as server |
| `GOOGLE_REDIRECT_URI` | `https://<app>.vercel.app/api/auth/google/callback` |
| `NEXT_PUBLIC_FIREBASE_*` | same 7 values as local `.env` |

## 5. Firebase console checklist (`whatsappagentcrm`)

- Authentication → Sign-in method: enable **Email/Password** and **Google**.
- Authentication → Settings → Authorized domains: add `localhost` (dev) and
  your `<app>.vercel.app` domain (prod).
- Optional later: App Check + per-user Firestore rules if operator data grows.

## 6. Backups (cron on the box)

```bash
# nightly pg_dump including the whatsmeow session DBs
0 2 * * * docker exec $(docker ps -qf name=postgres) \
  pg_dump -U strucureo strucureo | gzip > /var/backups/strucureo-$(date +\%F).sql.gz
```

Restore rehearsal into a scratch DB before you ever need it for real.

## 7. Notes / limits

- WhatsApp sessions live in Postgres (`whatsmeow_*` DBs). Same DB = sessions
  survive redeploys; fresh DB = re-pair every number.
- 2 GB budget: `AGENT_POOL_SIZE=10`, PG `max_connections=60`. Raise only
  after measuring (`make prod-ps`, watch for OOM kills in `dmesg`).
- Server-side Firebase Admin verification of dashboard API calls is NOT wired
  yet (needs a service-account key) — dashboard APIs currently trust the
  authed browser session. Do not expose the dashboard URL publicly beyond
  your operators until that's in.
