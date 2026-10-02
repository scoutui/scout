import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeJson, ScanValidationError } from "@/lib/scan-validation";
import { sampleArtifact } from "../helpers/scan-artifact";

async function* chunks(bytes: Uint8Array, size = 7) {
  for (let offset = 0; offset < bytes.byteLength; offset += size) yield bytes.subarray(offset, offset + size);
}
const encode = (value: unknown) => gzipSync(Buffer.from(typeof value === "string" ? value : JSON.stringify(value)));
const clone = () => structuredClone(sampleArtifact());
function flip(bytes: Buffer, fromEnd: number) {
  const index = bytes.length - fromEnd;
  bytes.writeUInt8(bytes.readUInt8(index) ^ 0xff, index);
  return bytes;
}

describe("artifact decoding", () => {
  it("decodes chunked gzip into the artifact", async () => {
    expect(await decodeJson(chunks(encode(sampleArtifact())), 1024 * 1024)).toEqual(sampleArtifact());
  });

  it("accepts a decoded size exactly at the cap and rejects one byte less", async () => {
    const text = JSON.stringify(sampleArtifact());
    const bytes = Buffer.byteLength(text);
    await expect(decodeJson(chunks(encode(text)), bytes)).resolves.toEqual(sampleArtifact());
    await expect(decodeJson(chunks(encode(text)), bytes - 1)).rejects.toMatchObject({ code: "decoded_limit" });
  });

  it("stops an expanding archive at the decoded cap", async () => {
    await expect(decodeJson(chunks(encode(" ".repeat(4 * 1024 * 1024)), 1024), 64 * 1024)).rejects.toMatchObject({ code: "decoded_limit" });
  });

  it("decodes multi-byte characters split across chunks", async () => {
    const input = clone();
    const occurrence = input.occurrences[0] ?? expect.unreachable();
    occurrence.filePath = "src/ビュー☀️.tsx";
    expect(await decodeJson(chunks(encode(input), 3), 1024 * 1024)).toEqual(input);
  });

  it.each([
    ["an empty archive", () => Buffer.alloc(0)],
    ["bytes that are not gzip", () => Buffer.from("not gzip at all")],
    ["a truncated stream", () => encode(sampleArtifact()).subarray(0, -3)],
    ["a corrupt checksum trailer", () => flip(encode(sampleArtifact()), 6)],
    ["a corrupt length trailer", () => flip(encode(sampleArtifact()), 1)],
    ["trailing garbage", () => Buffer.concat([encode(sampleArtifact()), Buffer.from("junk")])],
  ])("rejects %s as invalid gzip", async (_, bytes) => {
    await expect(decodeJson(chunks(bytes()), 1024 * 1024)).rejects.toMatchObject({ name: "ScanValidationError", code: "invalid_gzip" });
  });

  it.each(["", "{", "{\"meta\":", "[1,]"])("rejects undecodable JSON %j", async text => {
    await expect(decodeJson(chunks(encode(text)), 1024)).rejects.toMatchObject({ code: "invalid_json" });
  });

  it("propagates archive read failures without classifying them as invalid input", async () => {
    async function* failing() { yield encode(sampleArtifact()).subarray(0, 10); throw new Error("connection reset"); }
    const failure = await decodeJson(failing(), 1024 * 1024).catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ScanValidationError);
    expect(failure).toMatchObject({ message: "connection reset" });
  });
});
