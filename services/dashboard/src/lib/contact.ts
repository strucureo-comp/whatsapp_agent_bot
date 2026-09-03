/**
 * Client-safe contact constants. lives apart from queries.ts on purpose:
 * queries.ts imports pg (Node-only), so anything a Client Component imports
 * at runtime must come from here instead.
 */

export type ContactTag = "new_lead" | "prospect" | "converted" | "vip" | "blocked";

export const CONTACT_TAGS: { value: ContactTag; label: string }[] = [
  { value: "new_lead", label: "New lead" },
  { value: "prospect", label: "Prospect" },
  { value: "converted", label: "Converted" },
  { value: "vip", label: "VIP" },
  { value: "blocked", label: "Blocked" },
];
