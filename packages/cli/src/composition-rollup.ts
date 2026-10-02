/**
 * Owner-edge composition rollup: a two-pass fold over the flat occurrence
 * stream that doesn't mutate its inputs.
 *
 * Pass 1 indexes occurrences by their ownerComponentId.
 *
 * Pass 2 visits each component and accumulates:
 *   - rendersByCount: child componentId → count of occurrences this component
 *     owns. Built from the pass-1 index.
 *   - renderedByCount: parent componentId → count of times this component
 *     appears with that owner.
 *   - isRootCount: occurrences of this component with no ownerComponentId.
 *   - isLeafCount: this component's own occurrences whose rendersByCount is
 *     empty (i.e. the component doesn't own anything).
 *
 * Every component gets a composition block, even with no occurrences and
 * nothing owned, so graph traversals always find the field.
 */
import type { Component, CompositionRollup, ResolvedOccurrence } from "@scoutui/scan-format";
import type { RolledComponent } from "./rollup.js";

export function applyCompositionRollup(
  components: readonly RolledComponent[],
  occurrences: readonly ResolvedOccurrence[],
): Component[] {
  const childrenByOwner = new Map<string, Map<string, number>>();
  const ownersByChild = new Map<string, Map<string, number>>();
  const rootCountByChild = new Map<string, number>();

  for (const o of occurrences) {
    const { componentId } = o.resolution;
    if (o.ownerComponentId) {
      let m = childrenByOwner.get(o.ownerComponentId);
      if (!m) {
        m = new Map();
        childrenByOwner.set(o.ownerComponentId, m);
      }
      m.set(componentId, (m.get(componentId) ?? 0) + 1);

      let m2 = ownersByChild.get(componentId);
      if (!m2) {
        m2 = new Map();
        ownersByChild.set(componentId, m2);
      }
      m2.set(o.ownerComponentId, (m2.get(o.ownerComponentId) ?? 0) + 1);
    } else {
      rootCountByChild.set(componentId, (rootCountByChild.get(componentId) ?? 0) + 1);
    }
  }

  const occsByComp = new Map<string, ResolvedOccurrence[]>();
  for (const o of occurrences) {
    const list = occsByComp.get(o.resolution.componentId);
    if (list) list.push(o);
    else occsByComp.set(o.resolution.componentId, [o]);
  }

  const validIds = new Set(components.map((c) => c.id));

  return components.map((c) => {
    const rendersByCount: Record<string, number> = {};
    const renderedByCount: Record<string, number> = {};
    const isRootCount = rootCountByChild.get(c.id) ?? 0;
    let isLeafCount = 0;

    const renders = childrenByOwner.get(c.id);
    if (renders) for (const [childId, n] of renders) rendersByCount[childId] = n;

    const owners = ownersByChild.get(c.id);
    if (owners) for (const [ownerId, n] of owners) renderedByCount[ownerId] = n;

    for (const k of Object.keys(rendersByCount)) if (!validIds.has(k)) delete rendersByCount[k];
    for (const k of Object.keys(renderedByCount)) if (!validIds.has(k)) delete renderedByCount[k];

    if (Object.keys(rendersByCount).length === 0) {
      isLeafCount = (occsByComp.get(c.id) ?? []).length;
    }

    const composition: CompositionRollup = {
      rendersByCount,
      renderedByCount,
      isRootCount,
      isLeafCount,
    };

    return { ...c, composition };
  });
}
