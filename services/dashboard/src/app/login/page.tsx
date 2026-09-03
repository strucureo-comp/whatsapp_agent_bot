"use client";

import { useState } from "react";
import Link from "next/link";
import { GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { LogIn, MessageCircle } from "lucide-react";
import { getFirebaseAuth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 pt-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <MessageCircle className="h-5 w-5" />
        </span>
        <h1 className="text-xl font-bold tracking-tight">Strucureo</h1>
        <p className="text-sm text-muted-foreground">WhatsApp Agent Platform</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Log in</CardTitle>
          <CardDescription>Operators only — customers never see this.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@strucureo.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") run(() => signInWithEmailAndPassword(getFirebaseAuth(), email, password));
              }}
            />
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <Button
            disabled={busy || !email || !password}
            onClick={() => run(() => signInWithEmailAndPassword(getFirebaseAuth(), email, password))}
          >
            <LogIn /> {busy ? "Logging in…" : "Log in"}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => run(() => signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider()))}
          >
            Continue with Google
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            No account?{" "}
            <Link href="/signup" className="font-medium text-foreground hover:underline">
              Sign up
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function friendly(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  if (code.includes("invalid-credential") || code.includes("wrong-password"))
    return "Wrong email or password.";
  if (code.includes("user-not-found")) return "No account with that email — sign up first.";
  if (code.includes("popup-closed")) return "Google sign-in was closed before finishing.";
  if (code.includes("operation-not-allowed"))
    return "This sign-in method is disabled — enable it in Firebase Console → Authentication.";
  if (code.includes("unauthorized-domain"))
    return "This domain isn't authorized — add it in Firebase Console → Authentication → Settings.";
  return err instanceof Error ? err.message : String(err);
}
