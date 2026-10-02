import type { Keychain } from "../../../src/auth/keychain.js";

export function fakeKeychain(options: { available?: boolean } = {}) {
  const entries = new Map<string, string>();
  const locked = new Set<string>();
  const keychain: Keychain = {
    get: async (host) => (locked.has(host) ? undefined : entries.get(host)),
    set: async (host, token) => {
      if (options.available === false) return false;
      entries.set(host, token);
      return true;
    },
    delete: async (host) => {
      entries.delete(host);
    },
  };
  return { entries, locked, keychain };
}
