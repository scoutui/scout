"use client";
import { useCallback, useSyncExternalStore } from "react";

export type NodeHighlight = "none" | "chain" | "dim";

/** External store for the active highlight set. The base is the pinned chain;
 *  the override is the current hover, cleared on leave or blur. Kept outside
 *  React so a hover re-renders only the nodes whose state changes. */
export class HighlightStore {
  private base: ReadonlySet<string> | null = null;
  private override: ReadonlySet<string> | null = null;
  private active: ReadonlySet<string> | null = null;
  private listeners = new Set<() => void>();

  setBase(next: ReadonlySet<string> | null): void {
    this.base = next;
    this.recompute();
  }

  setOverride(next: ReadonlySet<string> | null): void {
    this.override = next;
    this.recompute();
  }

  getActive(): ReadonlySet<string> | null {
    return this.active;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private recompute(): void {
    const next = this.override ?? this.base;
    if (next === this.active) return;
    this.active = next;
    for (const listener of this.listeners) listener();
  }
}

/** A node's own highlight state; the snapshot is a primitive, so React bails
 *  out of re-rendering unless this node's value actually flips. */
export function useNodeHighlight(store: HighlightStore, id: string): NodeHighlight {
  const getSnapshot = useCallback((): NodeHighlight => {
    const active = store.getActive();
    if (active === null) return "none";
    return active.has(id) ? "chain" : "dim";
  }, [store, id]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** The whole active set, for edge styling. */
export function useHighlightSet(store: HighlightStore): ReadonlySet<string> | null {
  const getSnapshot = useCallback(() => store.getActive(), [store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
