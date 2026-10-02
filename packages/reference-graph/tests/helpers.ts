import type { ComponentId } from "../src/types/component-id.js";

/** The export a component identity names; undefined for a tag or no identity. */
export const exportOf = (id: ComponentId | undefined): string | undefined =>
  id !== undefined && "export" in id ? id.export : undefined;
