import { describe, expect, it } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import { artifactSchema } from "../src/schema.js";

describe("scan-file.schema.json", () => {
  // Objects allow unknown fields, as validateArtifact does. Cross-field rules, custom shapes and timestamp
  // parsing can't be expressed in JSON Schema, so the file is looser than validateArtifact.
  it("matches the schema the scan file is validated against", async () => {
    const schema = zodToJsonSchema(artifactSchema, { $refStrategy: "none", removeAdditionalStrategy: "strict" });
    await expect(`${JSON.stringify(schema, null, 2)}\n`).toMatchFileSnapshot("../schema/scan-file.schema.json");
  });
});
