import { describe, it, expect, vi } from "vitest";
import { openBrowser } from "../../../src/auth/browser.js";

const HOST = "https://h.example";
const URL_ON_HOST = "https://h.example/login/device?code=ABCD-EFGH";

describe("openBrowser", () => {
  it("uses `open` on darwin", () => {
    const spawnFn = vi.fn(() => ({ on() {}, unref() {} }));
    expect(openBrowser(URL_ON_HOST, HOST, { platform: "darwin", spawnFn })).toBe(true);
    expect(spawnFn).toHaveBeenCalledWith("open", [URL_ON_HOST], expect.anything());
  });

  it("uses `xdg-open` on linux", () => {
    const spawnFn = vi.fn(() => ({ on() {}, unref() {} }));
    openBrowser(URL_ON_HOST, HOST, { platform: "linux", spawnFn });
    expect(spawnFn).toHaveBeenCalledWith("xdg-open", [URL_ON_HOST], expect.anything());
  });

  it("hands the URL to rundll32 on win32, without a shell", () => {
    const spawnFn = vi.fn(() => ({ on() {}, unref() {} }));
    openBrowser(`${URL_ON_HOST}&x=1`, HOST, { platform: "win32", spawnFn });
    expect(spawnFn).toHaveBeenCalledWith("rundll32", ["url.dll,FileProtocolHandler", `${URL_ON_HOST}&x=1`], expect.anything());
  });

  it.each([
    ["another host", "https://other.example/login/device"],
    ["the same host over http", "http://h.example/login/device"],
    ["a value that isn't a URL", "calc.exe"],
  ])("doesn't open %s", (_label, url) => {
    const spawnFn = vi.fn(() => ({ on() {}, unref() {} }));
    expect(openBrowser(url, HOST, { platform: "win32", spawnFn })).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("returns false when spawn throws", () => {
    const spawnFn = vi.fn(() => {
      throw new Error("nope");
    });
    expect(openBrowser(URL_ON_HOST, HOST, { platform: "linux", spawnFn })).toBe(false);
  });
});
