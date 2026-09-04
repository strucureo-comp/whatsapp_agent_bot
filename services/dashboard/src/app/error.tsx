"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error caught by boundary:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <div className="max-w-md space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          {error?.message || "An unexpected error occurred while loading this page."}
        </p>
        {error?.digest && (
          <p className="text-xs text-muted-foreground/70 font-mono">Digest: {error.digest}</p>
        )}
      </div>
      <Button onClick={() => reset()} variant="outline" size="sm">
        Try again
      </Button>
    </div>
  );
}
