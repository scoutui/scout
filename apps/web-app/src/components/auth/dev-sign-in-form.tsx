"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function DevSignInForm({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("admin");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await signIn("dev", {
      email,
      password,
      role,
      redirect: false,
    });
    setSubmitting(false);
    if (result?.error) {
      setError("Sign-in rejected. Check the email format and DEV_AUTH_PASSWORD.");
      return;
    }
    if (result?.ok) {
      window.location.href = callbackUrl;
    }
  };

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-2">
      <Input
        type="email"
        required
        placeholder="any@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
      />
      <Input
        type="password"
        required
        placeholder="DEV_AUTH_PASSWORD"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
      />
      <div className="space-y-1.5">
        <label htmlFor="dev-sign-in-role" className="block text-label text-muted-foreground">
          Role
        </label>
        <select
          id="dev-sign-in-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="h-8 w-full rounded-lg border border-control bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <Button type="submit" variant="outline" className="w-full" disabled={submitting}>
        {submitting ? "Signing in…" : "Dev sign-in"}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
