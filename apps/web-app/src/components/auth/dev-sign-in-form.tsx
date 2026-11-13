"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const DEV_ROLES = [
  { value: "viewer", label: "Viewer" },
  { value: "editor", label: "Editor" },
  { value: "admin", label: "Admin" },
];

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
      <div className="flex flex-col gap-1.5">
        <label htmlFor="dev-sign-in-role" className="block text-label text-muted-foreground">
          Role
        </label>
        <Select
          value={role}
          onValueChange={(next: string | null) => { if (next) setRole(next); }}
          items={DEV_ROLES}
        >
          <SelectTrigger id="dev-sign-in-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEV_ROLES.map(({ value, label }) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
