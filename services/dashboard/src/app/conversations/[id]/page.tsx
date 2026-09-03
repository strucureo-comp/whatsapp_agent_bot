import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getConversation, getMessages, getTickets } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ContactTagBadge, ConversationStatusBadge } from "@/components/status-badge";
import { AutoRefresh } from "@/components/auto-refresh";
import { AgentToggle } from "@/components/agent-toggle";
import { ContactDrawer } from "@/components/contact-drawer";
import { ResolveEscalationButton } from "@/components/resolve-button";
import { cn } from "@/lib/utils";

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  const [conversation, messages] = await Promise.all([
    getConversation(id),
    getMessages(id),
  ]);
  if (!conversation) notFound();
  const chatTickets = await getTickets({ conversationId: id });

  return (
    <div className="flex flex-col gap-4">
      <AutoRefresh intervalMs={5000} />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/conversations">
              <ArrowLeft />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg font-bold tracking-tight">
              {conversation.customer_name || conversation.customer_number}
            </h1>
            <p className="font-mono text-xs text-muted-foreground">
              {conversation.customer_number} · {conversation.tenant_name} · auto-refreshes every 5s
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {conversation.is_test ? <Badge variant="outline">test</Badge> : null}
          <ContactTagBadge tag={conversation.contact_tag} />
          <ConversationStatusBadge status={conversation.status} />
          <AgentToggle conversationId={conversation.id} status={conversation.status} compact />
          <ContactDrawer conversation={conversation} tickets={chatTickets} />
          {conversation.status === "escalated" ? (
            <ResolveEscalationButton conversationId={conversation.id} />
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Thread · {messages.length} messages</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No messages yet.</p>
            ) : (
              messages.map((m) => {
                const mine = m.role === "assistant";
                return (
                  <div key={m.id} className={cn("flex", mine ? "justify-start" : "justify-end")}>
                    <div
                      className={cn(
                        "max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap",
                        mine
                          ? "rounded-tl-sm bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200"
                          : "rounded-tr-sm bg-primary text-primary-foreground"
                      )}
                    >
                      <p>{m.content}</p>
                      <p
                        className={cn(
                          "mt-1 text-[10px]",
                          mine ? "text-muted-foreground" : "text-primary-foreground/70"
                        )}
                      >
                        {m.role} · {new Date(m.created_at).toLocaleString()}
                        {m.usage_json
                          ? ` · ${(m.usage_json.input_tokens ?? 0) + (m.usage_json.output_tokens ?? 0)} tok`
                          : ""}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
