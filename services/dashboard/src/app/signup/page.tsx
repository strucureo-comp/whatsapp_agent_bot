"use client";

import { useState } from "react";
import Link from "next/link";
import { GoogleAuthProvider, createUserWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { UserPlus, MessageCircle } from "lucide-react";
import { getFirebaseAuth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignupPage() {
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
      const code = (err as { code?: string })?.code ?? "";
      setError(
        code.includes("email-already-in-use")
          ? "That email already has an account — log in instead."
          : code.includes("weak-password")
            ? "Password needs at least 6 characters."
            : code.includes("operation-not-allowed")
              ? "Email sign-up is disabled — enable it in Firebase Console → Authentication."
              : err instanceof Error
                ? err.message
                : String(err)
      );
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
        <p className="text-sm text-muted-foreground">Create your operator account</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sign up</CardTitle>
          <CardDescription>One account operates all your tenants.</CardDescription>
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
            <Label htmlFor="password">Password (6+ characters)</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  run(() => createUserWithEmailAndPassword(getFirebaseAuth(), email, password));
              }}
            />
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <Button
            disabled={busy || !email || password.length < 6}
            onClick={() => run(() => createUserWithEmailAndPassword(getFirebaseAuth(), email, password))}
          >
            <UserPlus /> {busy ? "Creating…" : "Create account"}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => run(() => signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider()))}
          >
            Continue with Google
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Have an account?{" "}
            <Link href="/login" className="font-medium text-foreground hover:underline">
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
