import { describe, it, expect } from "vitest";
import { makeUserCode } from "@/lib/cli-device-codes";
describe("makeUserCode", () => {
  it("formats as XXXX-XXXX from an unambiguous alphabet", () => {
    expect(makeUserCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
  it("varies", () => { expect(makeUserCode()).not.toBe(makeUserCode()); });
});
