"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import {
  LayoutDashboard,
  MessagesSquare,
  Siren,
  Users,
  Wrench,
  Smartphone,
  MessageCircle,
  TicketCheck,
  CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/conversations", label: "Chats", icon: MessagesSquare },
  { href: "/tickets", label: "Tickets", icon: TicketCheck },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/escalations", label: "Escalations", icon: Siren },
  { href: "/tenants", label: "Tenants", icon: Users },
  { href: "/tools", label: "Tools", icon: Wrench },
  { href: "/whatsapp", label: "WhatsApp", icon: Smartphone },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-white md:flex md:flex-col">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <MessageCircle className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold tracking-tight">Strucureo</span>
      </div>
      <nav className="flex flex-col gap-1 p-3">
        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-2 border-t p-3">
        {user?.email ? (
          <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-2.5 py-1.5">
            <span className="truncate text-xs font-medium" title={user.email}>
              {user.email}
            </span>
            <button
              onClick={logout}
              title="Log out"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
        <a
          href="https://www.strucureo.com"
          target="_blank"
          rel="noreferrer"
          className="px-1 text-xs text-muted-foreground hover:underline"
        >
          Strucureo · strucureo.com
        </a>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 overflow-x-auto border-b bg-white px-3 py-2 md:hidden">
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            )}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
