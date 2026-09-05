import { connection } from "next/server";
import Link from "next/link";
import { ArrowLeft, Mail, MessageCircle, MessageSquare, Search } from "lucide-react";
import { requireAuth } from "@/lib/auth-server";
import { getConversation, getConversations, getMessages, getTenants, getTickets } from "@/lib/queries";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ContactTagBadge, ConversationStatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { AutoRefresh } from "@/components/auto-refresh";
import { AgentToggle } from "@/components/agent-toggle";
import { ContactDrawer } from "@/components/contact-drawer";
import { ClearTestChats } from "@/components/clear-test-chats";
import { ResolveEscalationButton } from "@/components/resolve-button";
import { ChatThread } from "@/components/chat-thread";
import { cn } from "@/lib/utils";

function displayName(c: { customer_name?: string | null; customer_number?: string | null; customer_email?: string | null }) {
  return c.customer_name || c.customer_email || c.customer_number || "Inquiry";
}

const STATUSES = ["all", "active", "escalated", "human_handling", "closed"];
const CHANNELS = ["all", "whatsapp", "email"];

function keepParams(
  base: Record<string, string | undefined>,
  patch: Record<string, string | undefined>
) {
  const q = new URLSearchParams();
  const merged = { ...base, ...patch };
  for (const [k, v] of Object.entries(merged)) {
    if (v) q.set(k, v);
  }
  const str = q.toString();
  return `/conversations${str ? `?${str}` : ""}`;
}

export default async function ConversationsPage(props: { searchParams: Promise<any> }) {
  await connection();
  const uid = await requireAuth();
  const params = await props.searchParams;
  const tenantId = params.tenant || undefined;
  const status = params.status && params.status !== "all" ? params.status : undefined;
  const channel = params.channel && params.channel !== "all" ? params.channel : undefined;
  const base = { tenant: tenantId, status: params.status, channel: params.channel, test: params.test, q: params.q };

  const [tenants, conversations] = await Promise.all([
    getTenants(uid),
    getConversations(uid, { tenantId, status, channel, includeTest: params.test === "1", search: params.q }),
  ]);

  const selected = params.c ? await getConversation(params.c, uid) : null;
  const [thread, chatTickets] = selected
    ? await Promise.all([getMessages(selected.id, uid), getTickets(uid, { conversationId: selected.id })])
    : [[], []];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Chats & Inboxes</h1>
          <p className="text-sm text-muted-foreground">
            Omnichannel inbox · WhatsApp & Inbound Email · live AI replies and human handoff
          </p>
        </div>
        <ClearTestChats tenantId={tenantId} />
      </div>

      <div className="grid overflow-hidden rounded-xl border bg-white md:grid-cols-[340px_1fr] h-[calc(100vh-170px)] min-h-[560px]">
        {/* ── Left: search + chat list ─────────────────────────── */}
        <div className={cn("flex flex-col h-full min-h-0 border-r", selected ? "hidden md:flex" : "flex")}>
          <div className="flex flex-col gap-2 border-b p-3 shrink-0">
            <form action="/conversations" method="get" className="flex gap-2">
              {tenantId ? <input type="hidden" name="tenant" value={tenantId} /> : null}
              {params.status ? <input type="hidden" name="status" value={params.status} /> : null}
              {params.channel ? <input type="hidden" name="channel" value={params.channel} /> : null}
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input name="q" defaultValue={params.q ?? ""} placeholder="Search number, email…" className="pl-8" />
              </div>
              <Button type="submit" variant="outline" size="sm">
                Go
              </Button>
            </form>

            {/* Channels toggle */}
            <div className="flex items-center gap-1 border-b pb-1.5 pt-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">Channel:</span>
              {CHANNELS.map((ch) => {
                const active = (params.channel ?? "all") === ch;
                return (
                  <Link
                    key={ch}
                    href={keepParams(base, { channel: ch === "all" ? undefined : ch })}
                    className={cn(
                      "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                      active
                        ? ch === "email"
                          ? "bg-blue-600 text-white"
                          : ch === "whatsapp"
                            ? "bg-emerald-600 text-white"
                            : "bg-zinc-800 text-white"
                        : "text-muted-foreground hover:bg-accent"
                    )}
                  >
                    {ch === "whatsapp" && <MessageCircle className="h-3 w-3" />}
                    {ch === "email" && <Mail className="h-3 w-3" />}
                    {ch === "all" ? "All" : ch.charAt(0).toUpperCase() + ch.slice(1)}
                  </Link>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-1">
              <Link
                href={keepParams(base, { tenant: undefined })}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  !tenantId ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                )}
              >
                All Tenants
              </Link>
              {tenants.map((t) => (
                <Link
                  key={t.id}
                  href={keepParams(base, { tenant: t.id })}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    tenantId === t.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                  )}
                >
                  {t.name}
                </Link>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {STATUSES.map((s) => {
                const active = (params.status ?? "all") === s;
                return (
                  <Link
                    key={s}
                    href={keepParams(base, { status: s })}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px]",
                      active ? "bg-secondary font-semibold" : "text-muted-foreground hover:bg-accent"
                    )}
                  >
                    {s.replace("_", " ")}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No conversations match.</p>
            ) : (
              conversations.map((c) => {
                const isSel = selected?.id === c.id;
                const isEmail = c.channel === "email";
                const avatarColor =
                  c.status === "escalated"
                    ? "bg-red-500"
                    : c.status === "human_handling"
                      ? "bg-amber-500"
                      : isEmail
                        ? "bg-blue-600"
                        : "bg-emerald-600";
                return (
                  <Link
                    key={c.id}
                    href={keepParams(base, { c: c.id })}
                    className={cn(
                      "flex items-center gap-3 border-b px-3 py-2.5 hover:bg-accent/60",
                      isSel && "bg-accent"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white relative",
                        avatarColor
                      )}
                    >
                      {isEmail ? <Mail className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
                      <span
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] text-white border border-white",
                          isEmail ? "bg-blue-700" : "bg-emerald-700"
                        )}
                        title={c.channel}
                      >
                        {isEmail ? "@" : "W"}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs font-semibold">
                          {displayName(c)}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {c.last_message_at ? formatDateTime(c.last_message_at).split(",")[0] : ""}
                        </span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-muted-foreground">
                          {c.last_snippet ?? "No messages yet"}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.2 text-[9px] font-medium uppercase tracking-wider",
                              isEmail ? "bg-blue-50 text-blue-700 border border-blue-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            )}
                          >
                            {c.channel || "whatsapp"}
                          </span>
                          {c.contact_tag !== "new_lead" ? (
                            <ContactTagBadge tag={c.contact_tag} />
                          ) : null}
                          {c.status !== "active" ? (
                            <ConversationStatusBadge status={c.status} />
                          ) : null}
                        </span>
                      </span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">
                        {c.customer_email || c.customer_number}
                      </span>
                    </span>
                  </Link>
                );
              }))}
          </div>
        </div>

        {/* ── Right: thread ────────────────────────────────────── */}
        <div className={cn("flex flex-col h-full min-h-0 bg-[#efeae2]", selected ? "flex" : "hidden md:flex")}>
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-8 bg-[#f7f5f2]">
              <EmptyState
                icon={MessageCircle}
                title="Select a chat"
                hint="Pick a conversation on the left to read its full history and reply."
              />
            </div>
          ) : (
            <ChatThread
              conversation={selected}
              initialMessages={thread}
              chatTickets={chatTickets}
            />
          )}
        </div>
      </div>
    </div>
  );
}
