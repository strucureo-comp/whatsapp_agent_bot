# Strucureo WhatsApp Agent Platform — Implementation Checklist

The reasoning lives in the build plan (`strucureo-whatsapp-agent-platform-rustling-donut.md`
under `~/.claude/plans/`); this file is the tracker. One checkbox is one verifiable unit of
work.

The two entrypoints ship from **one codebase and one artifact** — `strucureo` (REPL) and
`strucureo daemon` (headless) are modes of the same binary, matching the single-process box in the
architecture diagram. Local development can run both in one process via a `--with-consumer` flag;
production runs the daemon under `Restart=always` and the operator attaches the REPL separately.

## Milestone 0 — Repo skeleton ✅

- [x] `services/agent-daemon/` (Node, ESM) and `services/gateway/` (Go) as sibling dirs, each independently installable
- [x] pnpm as package manager; exactly one lockfile committed
- [x] tsconfig project-reference split: root `files: []` → `tsconfig.app.json` + `tsconfig.node.json`; ES2022, `moduleResolution: bundler`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals`/`noUnusedParameters`, `@/*` → `./src/*`
- [x] `"typecheck": "tsc --noEmit"`; `tsx` for dev; vitest with `globals`/`mockReset`/`clearMocks`, `TZ=UTC` in CI
- [x] `.gitignore` excludes `.env`, session storage, and `*.db*` — day one, before any pairing happens
- [x] `.env.example` as the config contract, sectioned and commented
- [x] zod schema over `process.env` parsed at boot; process exits on failure rather than at 3am
- [x] pino with `{tenant_id, conversation_id}` bindings; custom `toJSON`/`util.inspect.custom` redaction on any type holding `auth_config`
- [x] dev compose: `pgvector/pgvector:pg16` + redis, ports bound to `127.0.0.1`
- [x] Makefile front door: `setup`, `migrate`, `dev`, `daemon`, `repl`, `test`, `typecheck`

## Week 1 — Schema, repos, both entrypoints boot ✅

- [x] Migration: `tenants` — `persona_prompt`, `status`, `llm_provider`, `llm_model`, `staff_whatsapp`, `google_calendar_id`, `max_monthly_spend_cents`, `reply_max_tokens` (400), `debounce_ms` (2500)
- [x] Migration: `tenant_tools` — `description TEXT NOT NULL`, `input_schema JSONB NOT NULL`, `endpoint`, `auth_config`, `permission`, `timeout_ms` (8000), `rate_limit_per_min`, `enabled`
- [x] Migration: `conversations` — `is_test` default false, `UNIQUE (tenant_id, customer_number)`, status enum; `messages` — `wa_message_id TEXT UNIQUE`, `usage_json JSONB`, index `(conversation_id, created_at)`
- [x] Migration: `escalations`; `audit_log` with index `(tenant_id, created_at)`; `whatsapp_sessions` as a read-only projection (`tenant_id`, `jid`, `status`, `last_seen_at`)
- [x] Migration: RLS enabled on every tenant-scoped table, policies keyed on `app.tenant_id`
- [x] `withTenant(tenantId, fn)` — opens a transaction, issues `SET LOCAL app.tenant_id`; every repo call goes through it
- [x] `db/repos/*` with `tenantId` as the first parameter of every function
- [x] Test: a repo call made without a tenant context returns zero rows — proves RLS is enforcing, not code review
- [x] `strucureo` REPL boots (inquirer, `fileURLToPath(import.meta.url) === process.argv[1]` guard)
- [x] `strucureo daemon` boots headless with no TTY dependency
- [x] `tenant create|use|list|pause|resume`
- [x] `config load <file.yaml>` as an idempotent upsert; `config show` emits YAML back for version control
- [x] systemd (or quadlet) units for daemon and gateway with `Restart=always`

## Week 2 — Go gateway: pairing, sessions, Streams, first round trip ✅

- [x] `go mod init`, whatsmeow + pgx; thin `main.go` (config → runtime → router → serve)
- [x] `sqlstore.NewWithDB(db, "postgres", log)` pointed at a dedicated `whatsmeow` schema, and **call `Upgrade(ctx)`** — `NewWithDB` does not migrate
- [x] `session/manager.go`: `map[TenantID]*whatsmeow.Client` behind an RWMutex, one `NewClient(deviceStore, log)` per tenant
- [x] Event handlers **close over the tenant id** — `AddEventHandler` passes no client argument. Add a test proving two tenants' messages never cross
- [x] Status state machine: `WaitingForQrScan{qr, expires_at, last_queued_at}`, `WaitingForPairingCode`, `Connected`, `Disconnected`, with `IsPendingPairing()` / `PendingSince()`
- [x] `GetQRChannel(ctx)` called **before** `Connect()`
- [x] `PairPhone(ctx, phone, ...)` pairing-code path — a code is far easier to relay over SSH than a rendered QR
- [x] Pending-session reaper: 60s sweep, disconnect and evict pairings older than 5 minutes
- [x] `MAX_CONCURRENT_PENDING_SESSIONS = 10`, return 429 past it
- [x] `GetAllDevices(ctx)` on boot restores every session
- [x] Reconnect with exponential backoff, jitter, and an attempt ceiling; on `loggedOut`/401 evict the device and surface `re_pair_required` instead of wedging
- [x] HTTP surface matching the existing house contract: `provision`, `pair`, `pair-code`, `qr?channel_id=`, `disconnect`, `messages/send`, `events`, `/health`
- [x] Auth on every endpoint; tenant identity from a signed token, **never** the request body
- [x] Inbound `XADD inbound:<tenantId>` carrying normalized JID (`ToNonAD().String()`), `AddressingMode`, phone when present, `wa_message_id`, media refs
- [x] Outbound `XREADGROUP` on `outbound:<tenantId>` → send → `XACK`, with `XAUTOCLAIM` recovery for entries left pending by a dead consumer
- [x] Media/text extraction: recursive unwrap of `ephemeralMessage` → `viewOnceMessage` → `viewOnceMessageV2` → `documentWithCaptionMessage`
- [x] Voice notes: `audio/ogg; codecs=opus` with `ptt: true`, retry `audio/mp4` on failure
- [x] `syncFullHistory: false`; choose device props deliberately and record the choice — they affect pairing acceptance
- [x] `IsFromMe` / `DeviceSentMeta` flips `conversations.status = 'human_handling'`; confirm empirically that the event fires for a staff-phone reply
- [ ] **Round trip on a burner number**: message it from a personal phone, inbound row lands in `messages`, reply arrives on the phone

## Week 3 — Agent runtime, `handleMessage`, test mode, caching ✅

- [x] `channel.ts`: `sendText(tenantId, to, body)` plus the inbound event shape — the gateway lives behind this seam
- [x] `handleMessage(tenantId, conversationId, messages: InboundMessage[]): Promise<AgentReply>` — the single path to the model, list input
- [x] Per-conversation lock `SET lock:conv:<id> <token> NX PX 60000`; on contention do **not** `XACK`, let the entry be reclaimed
- [x] Debounce `tenants.debounce_ms` after the last inbound message, then one turn over the accumulated text
- [x] `toolRunner()` with `max_iterations: 6` and `max_tokens` from `tenants.reply_max_tokens`
- [x] Tools built with `betaTool()` (raw JSON Schema — tenant schemas are dynamic), `strict: true`, `additionalProperties: false`, `required` populated
- [x] **Sort tool definitions by name** before sending — assembling them from a DB query is the classic silent cache killer
- [x] Explicit `cache_control` breakpoint on the last `system` block (caches tools + persona per tenant, shared across that tenant's conversations); top-level `cache_control` for the conversation tail
- [x] Guard that no date, timestamp, or UUID is interpolated into `system` — today's date goes in a `messages` entry
- [x] `thinking` and effort per route — pinned per model (Anthropic: enabled for Claude models excluding Haiku)
- [x] Persist `usage_json` per message for per-tenant cost attribution
- [x] Reply length cap with truncation at a sentence boundary
- [x] Mock tool, and `test` calling `handleMessage` in-process against a conversation with `is_test = true`
- [ ] Test: a second identical turn reports `cache_read_input_tokens > 0`
- [ ] Test: `test` and a real WhatsApp message produce equivalent `messages` rows

## Week 4 — Tenant REST tools, permission gate, SSRF ✅

- [x] REST connector driven by `tenant_tools` rows; `auth_config` read at call time only
- [x] Permission gate **inside each tool's `run()`**; a denial returns an error result to the model, never to the customer
- [x] Every tool attempt written to `audit_log` with `allowed` true/false
- [x] SSRF validation **at registration time**: require https, resolve the hostname, reject private, loopback, and link-local ranges (`169.254.169.254` is the cloud metadata endpoint), re-validate after redirects rather than following blindly
- [x] Per-tool `timeout_ms` and a response-size cap — a slow tool hangs a consumer, a huge one blows the context window
- [x] `rate_limit_per_min` enforced per tool
- [x] Tool results delimited as untrusted data; no write action is ever authorized by text, only by the deterministic check
- [x] Test that greps an outgoing request body and the rendered prompt for the secret — `auth_config` must never reach `system`, tool descriptions, or tool results (tool-redact.spec.ts)
- [x] Retry discipline on outbound tool calls: retry `[429, 500, 502, 503, 504]`, 3 attempts, exponential backoff, typed error carrying status
- [x] `tools add|remove|list` REPL commands
- [x] Test: a write-scoped tool registered with `permission = 'read'` is refused, `audit_log.allowed = false`, and the customer-facing reply does not mention the tool (dispatcher.spec.ts)
- [x] Test: `http://169.254.169.254/` and a private IP are both rejected at registration

## Week 5 — Security layer ✅

- [x] Haiku 4.5 classifier pre-pass via `messages.parse()` + `zodOutputFormat`, `max_tokens: 256`; fall back to a single tool with forced `tool_choice` if structured output misbehaves
- [x] Flagged input short-circuits to a canned reply and is logged — never load-bearing on its own
- [x] Redis sliding-window rate limit per customer number
- [x] Per-tenant ceiling plus `max_monthly_spend_cents` enforcement, so one tenant's spike is not billed to Strucureo
- [x] Operator channel: append `{role: "system"}` to `messages[]`; explicit fallback path when the tenant's `llm_model` does not support it — never silently place operator text in a user turn
- [x] Jailbreak scenario set: instruction override, developer mode, system-prompt extraction, out-of-scope write attempt, discount extraction
- [x] `test --scenario jailbreak` runs the set
- [x] Test: all five refused, nothing leaked, no tool invoked (jailbreak.spec.ts)

## Week 6 — Escalation and calendar ✅

- [x] Triggers: first-time client needing onboarding, complaint/urgency sentiment, low confidence or repeated tool failure, explicit request for a human
- [x] `conversations.status = 'escalated'` plus a holding message to the customer
- [x] Staff notify to `tenants.staff_whatsapp` with a conversation summary
- [x] Bot stays silent while escalated; `escalations list` and `escalations resolve <id>` hand control back to the bot
- [x] Google service account; tenant shares the calendar with "make changes to events". Document the limitation: events show the service account as organizer without Workspace domain-wide delegation
- [x] `freebusy` → propose 2–3 slots
- [x] Proposed slots held in Redis with a short TTL (slots.spec.ts)
- [x] Re-check `freebusy` at confirm time before creating the event (slots.ts)
- [x] Test: two customers offered an overlapping slot — only one event is created (slots.spec.ts)

## Week 7 — Observability and hot reload ✅

- [x] Postgres `LISTEN`/`NOTIFY` on message insert; `logs --tail` excluding `is_test` by default
- [x] `logs --tenant X --status escalated`
- [x] `stats [--tenant X]` as SQL aggregates, including cost derived from `usage_json`
- [x] `config reload` writes the DB then `PUBLISH strucureo:config:reload <tenantId>`; the daemon invalidates its cache
- [x] `whatsapp connect|status|disconnect` wired through to the gateway API
- [x] `{tenant_id, conversation_id, wa_message_id}` present on log lines end to end — nothing in the family has correlation ids today

## Week 8 — Load, reconnect, crash safety

- [ ] Synthetic load at 50–100 concurrent sessions on one gateway
- [ ] Watch Postgres connection count and reconnect behaviour rather than throughput — throughput is not the binding constraint at this scale
- [ ] Reconnect storm: restart the gateway with N live sessions, confirm all recover
- [ ] Logout path: revoke the link from the phone, confirm the session surfaces `re_pair_required` and does not wedge
- [ ] Crash safety: send a message, `kill -9` the daemon mid-turn, restart — the customer gets **exactly one** reply
- [x] Burst: three messages in two seconds → one agent turn, one reply
- [x] Pool sizes decided from measurement and written into `.env.example`

## Weeks 9–10 — Eval harness, resilience, backup/restore

- [x] Capture ~50 real transcripts per tenant, pseudonymize customer numbers, store as fixtures
- [x] Replay harness runs fixtures through `handleMessage` with tools stubbed at the dispatcher seam — the third consumer of the single entry point
- [x] Deterministic assertions: escalated when it should have, correct tool with correct arguments, under the reply cap, jailbreak set refused
- [x] Judge model for tone only, reported as a score rather than gating
- [x] Sum `usage_json` per run; report cost and cache-hit-rate deltas against the previous run
- [x] `eval run` / `eval diff` on the same command surface as everything else
- [x] `pg_dump` on a schedule, including the `whatsmeow` schema
- [x] **Restore rehearsal** into a scratch database — an untested backup is not a backup
- [x] Per-tenant proxy support (`SetProxyAddress`) and conservative send rates against the ban risk
- [x] No unsolicited outbound messaging, enforced in code rather than policy

## Weeks 11–12 — Pilot

- [ ] Onboard 2–3 real tenants via `config load`
- [ ] Baseline eval run per tenant before any prompt tuning, so later runs have something to diff against
- [ ] Daily review of `escalations` and of `audit_log` denials
- [ ] Per-tenant spend from `usage_json` compared against `max_monthly_spend_cents`
- [ ] Decide per tenant whether `claude-sonnet-5` holds up on their real transcripts, using the eval cost totals

## Standing checks — re-run weekly

- [ ] Round trip on a real number
- [ ] Test/prod parity: same input through `test` and through WhatsApp, diff the `messages` rows
- [ ] Permission enforcement refused and audited
- [ ] Jailbreak scenario set
- [ ] Crash safety: exactly one reply after `kill -9`
- [ ] Burst coalescing: one turn, one reply
- [ ] `cache_read_input_tokens > 0` on a second turn
- [ ] SSRF rejection at registration
- [ ] Two tenants, same customer phone number, distinct conversations and personas

## Hard gate before any real customer traffic

- [ ] Round trip passes on a real number
- [ ] Permission enforcement passes **as an automated test**, not by hand
- [ ] Exactly one reply after a mid-turn crash

## Unrelated to this build, but do it anyway

- [ ] Rotate the live Chatwoot API token hardcoded at `crm/chatwoot/services/whatsapp_worker/index.js:25`
- [ ] Deal with the ~20 unencrypted `whatsapp_sessions.db_wa_new_*` files beside the Rust gateway source — they hold live Signal key material for really-paired devices
