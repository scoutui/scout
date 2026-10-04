"use client";

import { useFormStatus } from "react-dom";

const choices = {
  approve: {
    label: "Approve",
    pendingLabel: "Approving…",
    className: "bg-primary text-primary-foreground hover:bg-primary/90",
  },
  deny: {
    label: "Deny",
    pendingLabel: "Denying…",
    className: "border border-destructive/30 bg-destructive/6 text-[color-mix(in_oklab,var(--destructive)_85%,var(--foreground))] hover:bg-destructive/8 dark:bg-destructive/10 dark:hover:bg-destructive/15",
  },
  switch: {
    label: "Use another account",
    pendingLabel: "Switching account…",
    className: "text-muted-foreground underline underline-offset-4 hover:text-foreground",
  },
} as const;

export function DeviceSubmitButton({ intent }: { intent: keyof typeof choices }) {
  const { pending } = useFormStatus();
  const choice = choices[intent];

  return (
    <button
      type="submit"
      disabled={pending}
      className={`min-h-10 w-full rounded-md px-4 py-2 text-sm font-medium whitespace-normal transition-colors disabled:cursor-wait disabled:opacity-50 ${choice.className}`}
    >
      <span aria-live="polite">{pending ? choice.pendingLabel : choice.label}</span>
    </button>
  );
}
