import { sha1 } from "@noble/hashes/legacy";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import type { Identity } from "./schema.js";

/** Canonical identity → component id. Isomorphic: runs in the CLI and in the browser bundle. */
export function componentKey(identity: Identity): string {
  const tuple =
    identity.kind === "package-export"
      ? [identity.kind, identity.packageName, identity.publicEntry, identity.exportName]
      : identity.kind === "repository-declaration"
        ? [identity.kind, identity.repoId, identity.filePath, identity.exportName]
        : [identity.kind, identity.tagName];
  return bytesToHex(sha1(utf8ToBytes(JSON.stringify(tuple)))).slice(0, 16);
}
