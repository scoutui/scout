import { describe, it, expect } from "vitest";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../../src/config/loader.js";

async function writeConfig(body: object): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cc-config-"));
  const path = join(dir, "scout.config.json");
  await writeFile(path, JSON.stringify(body), "utf8");
  return path;
}

describe("config: host field", () => {
  it("loads host when present", async () => {
    const p = await writeConfig({
      include: ["src/**/*.ts"],
      host: "https://scout.example.com",
    });
    const cfg = await loadConfig(p);
    expect(cfg.host).toBe("https://scout.example.com");
  });

  it("leaves host undefined when absent", async () => {
    const p = await writeConfig({ include: ["src/**/*.ts"] });
    const cfg = await loadConfig(p);
    expect(cfg.host).toBeUndefined();
  });

  it("rejects non-string host", async () => {
    const p = await writeConfig({ include: ["src/**/*.ts"], host: 42 });
    await expect(loadConfig(p)).rejects.toThrow(/host/);
  });
});
