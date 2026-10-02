import { existsSync } from "node:fs";
import { join } from "node:path";

export function isPnpProject(root: string): boolean {
  return existsSync(join(root, ".pnp.cjs")) || existsSync(join(root, ".pnp.loader.mjs"));
}
