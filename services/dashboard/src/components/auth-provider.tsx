"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { MessageCircle } from "lucide-react";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase";
import { MobileNav, Sidebar } from "@/components/sidebar";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  configError: string | null;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({ user: null, loading: true, configError: null, logout: async () => undefined });

export function useAuth() {
  return useContext(Ctx);
}

const PUBLIC_PATHS = ["/login", "/signup"];

function Splash({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <MessageCircle className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium">Strucureo</p>
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const isConfigured = isFirebaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isConfigured);
  const [configError, setConfigError] = useState<string | null>(
    isConfigured ? null : "Firebase env missing — add NEXT_PUBLIC_FIREBASE_* to .env"
  );

  useEffect(() => {
    if (!isConfigured) return;
    let unsub: () => void = () => undefined;
    try {
      unsub = onAuthStateChanged(getFirebaseAuth(), (u) => {
        setUser(u);
        if (u) {
          document.cookie = `auth_uid=${u.uid}; path=/; max-age=86400; samesite=lax`;
        } else {
          document.cookie = `auth_uid=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
        }
        setLoading(false);
      });
    } catch (err) {
      queueMicrotask(() => {
        setConfigError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    }
    return unsub;
  }, [isConfigured]);

  async function logout() {
    try {
      document.cookie = `auth_uid=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      await signOut(getFirebaseAuth());
    } catch {
      // already out — nothing to do
    }
  }

  return <Ctx.Provider value={{ user, loading, configError, logout }}>{children}</Ctx.Provider>;
}

/** App shell: public auth pages stay bare, everything else needs a session. */
export function AuthShell({ children }: { children: ReactNode }) {
  const { user, loading, configError } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    if (loading || configError) return;
    if (!user && !isPublic) router.replace("/login");
    if (user && isPublic) router.replace("/");
  }, [user, loading, configError, isPublic, router]);

  if (loading) return <Splash message="Signing you in…" />;
  if (configError) return <Splash message={configError} />;
  if (!user && !isPublic) return <Splash message="Redirecting to login…" />;
  if (user && isPublic) return <Splash message="Opening dashboard…" />;

  if (isPublic) {
    return <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">{children}</main>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
