"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const INTERVAL_MS = 5_000;

/** Calls `check` every few seconds while the browser tab is visible, and once when it becomes visible again. */
export function RecheckWhilePreparing({ check }: { check: () => void }) {
  const latest = useRef(check);
  latest.current = check;
  useEffect(() => {
    const run = () => {
      if (document.visibilityState !== "hidden") latest.current();
    };
    const timer = setInterval(run, INTERVAL_MS);
    document.addEventListener("visibilitychange", run);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, []);
  return null;
}

/** Re-renders the page on the server on the same schedule. */
export function RefreshPageWhilePreparing() {
  const router = useRouter();
  return <RecheckWhilePreparing check={() => router.refresh()} />;
}
