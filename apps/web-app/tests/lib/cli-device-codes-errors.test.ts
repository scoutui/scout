import { beforeEach, describe, expect, it, vi } from "vitest";
import { DrizzleQueryError } from "drizzle-orm/errors";
import * as realSchema from "@/db/schema";
import { hashToken } from "@/lib/cli-session-tokens";

const mockGetDb = vi.fn();
vi.mock("@/db/client", () => ({ getDb: mockGetDb, schema: realSchema }));

const {
  createDeviceCode, deleteDeniedDeviceCode, findByDeviceCodeHash, findByUserCode,
  markApproved, markDenied, pruneDeviceCodes, touchPoll,
} = await import("@/lib/cli-device-codes");

const rawCredential = "device-code-secret";
const credentialHash = hashToken(rawCredential);

beforeEach(() => {
  mockGetDb.mockImplementation(() => {
    throw new DrizzleQueryError("credential query", [credentialHash], new Error(rawCredential));
  });
});

describe("CLI device code database failures", () => {
  it.each([
    ["creation", () => createDeviceCode()],
    ["device-code lookup", () => findByDeviceCodeHash(credentialHash)],
    ["user-code lookup", () => findByUserCode("ABCD-EFGH")],
    ["pruning", () => pruneDeviceCodes()],
    ["denied-code deletion", () => deleteDeniedDeviceCode("d1")],
    ["approval", () => markApproved("ABCD-EFGH", "u1")],
    ["denial", () => markDenied("ABCD-EFGH")],
    ["poll touch", () => touchPoll("d1")],
  ])("sanitizes %s errors without retaining credential parameters", async (_operation, execute) => {
    try {
      await execute();
      throw new Error("Expected a database failure");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const sanitized = error as Error;
      expect(sanitized.message).toBe("CLI credential store unavailable");
      expect(sanitized.cause).toBeUndefined();
      expect(String(sanitized)).not.toContain(rawCredential);
      expect(String(sanitized)).not.toContain(credentialHash);
    }
  });
});
