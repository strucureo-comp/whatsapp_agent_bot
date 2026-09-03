import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ConversationStatusBadge({ status }: { status: string }) {
  const variant =
    status === "escalated" ? "destructive" : status === "active" ? "success" : "secondary";
  return <Badge variant={variant}>{status.replace("_", " ")}</Badge>;
}

export function TenantStatusBadge({ status }: { status: string }) {
  return <Badge variant={status === "active" ? "success" : "secondary"}>{status}</Badge>;
}

export function SessionStatusBadge({ status }: { status: string | null | undefined }) {
  const s = (status ?? "unknown").toLowerCase();
  const variant = s === "connected" ? "success" : s.includes("waiting") || s.includes("pairing") ? "warning" : "secondary";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          s === "connected" ? "bg-green-500" : s.includes("waiting") || s.includes("pairing") ? "bg-amber-500" : "bg-zinc-400"
        )}
      />
      <Badge variant={variant}>{s.replace(/_/g, " ")}</Badge>
    </span>
  );
}

export function PermissionBadge({ permission }: { permission: string }) {
  return <Badge variant={permission === "write" ? "warning" : "outline"}>{permission}</Badge>;
}

const TAG_LABEL: Record<string, string> = {
  new_lead: "New lead",
  prospect: "Prospect",
  converted: "Converted",
  vip: "VIP",
  blocked: "Blocked",
};

export function ContactTagBadge({ tag }: { tag: string }) {
  const variant =
    tag === "converted" || tag === "vip"
      ? "success"
      : tag === "blocked"
        ? "destructive"
        : tag === "prospect"
          ? "warning"
          : "secondary";
  return <Badge variant={variant}>{TAG_LABEL[tag] ?? tag}</Badge>;
}

export function TicketStatusBadge({ status }: { status: string }) {
  const variant =
    status === "resolved" ? "success" : status === "in_progress" ? "warning" : "destructive";
  return <Badge variant={variant}>{status.replace("_", " ")}</Badge>;
}
