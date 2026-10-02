import { afterEach, vi } from "vitest";
import { systemKeychain } from "../../src/auth/keychain.js";

// Keeps every suite off the real OS keychain; tests that need one pass their own or set `systemKeychain`'s
// return value, which resets to "no keychain" after each test.
vi.mock("../../src/auth/keychain.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/auth/keychain.js")>()),
  systemKeychain: vi.fn(() => ({ get: async () => undefined, set: async () => false, delete: async () => {} })),
}));

afterEach(() => {
  vi.mocked(systemKeychain).mockReset();
});
