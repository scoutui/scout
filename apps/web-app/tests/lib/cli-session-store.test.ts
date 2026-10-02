import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { DrizzleQueryError } from "drizzle-orm/errors";
import type { SQL } from "drizzle-orm";
import * as realSchema from "@/db/schema";
import { hashToken } from "@/lib/cli-session-tokens";

const mockUserRows: Array<{ email: string }> = [];
const mockUpdateRows: Array<{ id: string }> = [];
const mockDeleteRows: Array<{ id: string }> = [];

const mockSelect = vi.fn((_fields: unknown) => ({
  from: vi.fn((_table: unknown) => ({ where: vi.fn((_condition: SQL) => ({ limit: vi.fn(async () => [...mockUserRows]) })) })),
}));
const mockUpdateWhere = vi.fn((_condition: SQL) => ({ returning: vi.fn(async () => [...mockUpdateRows]) }));
const mockUpdateSet = vi.fn((_values: unknown) => ({ where: mockUpdateWhere }));
const mockUpdate = vi.fn((_table: unknown) => ({ set: mockUpdateSet }));
const mockInsertValues = vi.fn(async (_values: { id: string; userId: string; tokenHash: string }) => []);
const mockInsert = vi.fn((_table: unknown) => ({ values: mockInsertValues }));
const mockDeleteWhere = vi.fn((_condition: SQL) => ({ returning: vi.fn(async () => [...mockDeleteRows]) }));
const mockDelete = vi.fn((_table: unknown) => ({ where: mockDeleteWhere }));
const mockExecute = vi.fn(async (_query: SQL) => []);
const mockTx = { execute: mockExecute, update: mockUpdate, insert: mockInsert, select: mockSelect };
const mockTransaction = vi.fn(async (callback: (tx: typeof mockTx) => Promise<unknown>) => callback(mockTx));
const mockDb = {
  update: mockUpdate,
  delete: mockDelete,
  transaction: mockTransaction,
};

vi.mock("@/db/client", () => ({ getDb: () => mockDb, schema: realSchema }));

const { resolveCliSession, consumeApprovedDeviceCode, revokeCliSession } = await import("@/lib/cli-session-store");

const validToken = `scout_u_${"a".repeat(43)}`;
const dialect = new PgDialect();
const sensitiveFailure = () => new DrizzleQueryError("credential query", [hashToken(validToken)], new Error(validToken));

async function expectSanitizedFailure(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
    throw new Error("Expected a credential-store failure");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    const sanitized = error as Error;
    expect(sanitized.message).toBe("CLI credential store unavailable");
    expect(sanitized.cause).toBeUndefined();
    expect(String(sanitized)).not.toContain(validToken);
    expect(String(sanitized)).not.toContain(hashToken(validToken));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUserRows.length = 0;
  mockUpdateRows.length = 0;
  mockDeleteRows.length = 0;
});

describe("resolveCliSession", () => {
  it("rejects malformed tokens before any query", async () => {
    expect(await resolveCliSession("not-a-user-token")).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("does not expose a credential or its hash when resolution fails", async () => {
    mockUpdate.mockImplementationOnce(() => { throw sensitiveFailure(); });
    await expectSanitizedFailure(() => resolveCliSession(validToken));
  });
});

describe("consumeApprovedDeviceCode", () => {
  it("conditionally consumes the matching approval and persists only the token hash", async () => {
    mockUpdateRows.push({ id: "device-1" });
    mockUserRows.push({ email: "a@example.com" });

    const issued = await consumeApprovedDeviceCode("device-1", "user-1");

    expect(issued).toEqual({ token: expect.stringMatching(/^scout_u_[A-Za-z0-9_-]{43}$/), email: "a@example.com" });
    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledWith(realSchema.cliDeviceCodes);
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: "consumed" });
    const updateQuery = dialect.sqlToQuery(mockUpdateWhere.mock.calls[0]?.[0] as SQL);
    expect(updateQuery.sql).toContain('"cli_device_codes"."id"');
    expect(updateQuery.sql).toContain('"cli_device_codes"."status"');
    expect(updateQuery.sql).toContain('"cli_device_codes"."approved_user_id"');
    expect(updateQuery.params).toEqual(expect.arrayContaining(["device-1", "approved", "user-1"]));
    expect(mockInsert).toHaveBeenCalledWith(realSchema.cliSessions);
    const insertedSession = mockInsertValues.mock.calls[0]?.[0] as { id: string; userId: string; tokenHash: string };
    expect(insertedSession.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(insertedSession.userId).toBe("user-1");
    expect(insertedSession.tokenHash).toBe(hashToken(issued?.token ?? ""));
    expect(JSON.stringify(insertedSession)).not.toContain(issued?.token);
  });

  it("returns null without issuing a session when the conditional update loses", async () => {
    expect(await consumeApprovedDeviceCode("device-1", "user-1")).toBeNull();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("sanitizes insertion failure while the transaction rolls back", async () => {
    mockUpdateRows.push({ id: "device-1" });
    mockInsertValues.mockRejectedValueOnce(sensitiveFailure());
    await expectSanitizedFailure(() => consumeApprovedDeviceCode("device-1", "user-1"));
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it("fails the transaction if the approved local user cannot be resolved", async () => {
    mockUpdateRows.push({ id: "device-1" });
    await expect(consumeApprovedDeviceCode("device-1", "missing-user")).rejects.toThrow();
    expect(mockTransaction).toHaveBeenCalledOnce();
  });
});

describe("revokeCliSession", () => {
  it("rejects malformed tokens before querying", async () => {
    expect(await revokeCliSession("not-a-user-token")).toBe(false);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes a session by hash and returns whether a row was removed", async () => {
    expect(await revokeCliSession(validToken)).toBe(false);
    const query = dialect.sqlToQuery(mockDeleteWhere.mock.calls[0]?.[0] as SQL);
    expect(query.sql).toContain('"cli_sessions"."token_hash"');
    expect(query.params).toContain(hashToken(validToken));
    expect(query.params).not.toContain(validToken);

    mockDeleteRows.push({ id: "session-1" });
    expect(await revokeCliSession(validToken)).toBe(true);
  });

  it("does not expose a credential or its hash when revocation fails", async () => {
    mockDelete.mockImplementationOnce(() => { throw sensitiveFailure(); });
    await expectSanitizedFailure(() => revokeCliSession(validToken));
  });
});
