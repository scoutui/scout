import { describe, expect, it } from "vitest";
import { readScanUploadConfig } from "@/lib/scan-upload-config";

const MiB = 1024 * 1024;

describe("scan upload configuration", () => {
  it("defaults every setting", () => {
    expect(readScanUploadConfig({})).toEqual({
      maxWireBytes: 42 * MiB,
      maxStoredBytes: 42 * MiB,
      maxDecodedBytes: 64 * MiB,
      receiveTimeoutMs: 180_000,
      receiveSlots: 1,
      receiveSlotWaitMs: 60_000,
      maxQueuedUploads: null,
    });
  });

  it("reads every override", () => {
    expect(readScanUploadConfig({
      SCOUTUI_MAX_UPLOAD_BYTES: "100",
      SCOUTUI_MAX_STORED_UPLOAD_BYTES: "200",
      SCOUTUI_MAX_DECODED_ARTIFACT_BYTES: "300",
      SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS: "400",
      SCOUTUI_UPLOAD_RECEIVE_SLOTS: "2",
      SCOUTUI_UPLOAD_SLOT_WAIT_MS: "500",
      SCOUTUI_MAX_QUEUED_UPLOADS: "3",
    })).toEqual({
      maxWireBytes: 100, maxStoredBytes: 200, maxDecodedBytes: 300, receiveTimeoutMs: 400,
      receiveSlots: 2, receiveSlotWaitMs: 500, maxQueuedUploads: 3,
    });
  });

  it("defaults the stored limit to the wire limit", () => {
    expect(readScanUploadConfig({ SCOUTUI_MAX_UPLOAD_BYTES: "4096" }).maxStoredBytes).toBe(4096);
  });

  it.each([
    "SCOUTUI_MAX_UPLOAD_BYTES", "SCOUTUI_MAX_STORED_UPLOAD_BYTES", "SCOUTUI_MAX_DECODED_ARTIFACT_BYTES", "SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS",
    "SCOUTUI_UPLOAD_RECEIVE_SLOTS", "SCOUTUI_UPLOAD_SLOT_WAIT_MS", "SCOUTUI_MAX_QUEUED_UPLOADS",
  ])("rejects invalid %s values", (key) => {
    for (const value of ["", "0", "-1", "1.5", "42MiB", "NaN", "9007199254740993"]) {
      expect(() => readScanUploadConfig({ [key]: value }), value).toThrow(key);
    }
  });

  it("keeps the slot wait plus receive timeout inside the web server's request timeout", () => {
    expect(readScanUploadConfig({ SCOUTUI_UPLOAD_SLOT_WAIT_MS: "90000", SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS: "180000" })).toMatchObject({
      receiveSlotWaitMs: 90_000, receiveTimeoutMs: 180_000,
    });
    expect(() => readScanUploadConfig({ SCOUTUI_UPLOAD_SLOT_WAIT_MS: "90001", SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS: "180000" }))
      .toThrow(new Error("SCOUTUI_UPLOAD_SLOT_WAIT_MS (90001 ms) plus SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS (180000 ms) is 270001 ms. "
        + "Lower them so they add up to at most 270000 ms."));
    expect(() => readScanUploadConfig({ SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS: "300000" })).toThrow("SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS");
  });

  it("rejects timer settings beyond the platform timer range", () => {
    expect(() => readScanUploadConfig({ SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS: "2147483648" })).toThrow("SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS must be a positive integer");
    expect(() => readScanUploadConfig({ SCOUTUI_UPLOAD_SLOT_WAIT_MS: "2147483648" })).toThrow("SCOUTUI_UPLOAD_SLOT_WAIT_MS must be a positive integer");
  });
});
