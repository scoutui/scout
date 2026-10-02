import { describe, it, expect } from "vitest";
import { parseCommand, CliError, KNOWN_COMMANDS, unknownCommandMessage } from "../../../src/cli/parse.js";

describe("parseCommand", () => {
  it("parses scan string and boolean flags", () => {
    const { values } = parseCommand("scan", ["--config", "c.json", "--dry-run", "--quiet", "--repo-id", "r1"]);
    const { config, quiet, "repo-id": repoId } = values;
    expect(config).toBe("c.json");
    expect(values["dry-run"]).toBe(true);
    expect(quiet).toBe(true);
    expect(repoId).toBe("r1");
  });

  it("rejects an unknown flag with a suggestion and exit code 2", () => {
    try {
      parseCommand("scan", ["--dry-rn"]);
      throw new Error("expected parseCommand to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      const e = err as CliError;
      expect(e.exitCode).toBe(2);
      expect(e.message).toMatch(/unknown option '--dry-rn'/i);
      expect(e.message).toMatch(/did you mean '--dry-run'\?/i);
    }
  });

  it("rejects positionals for scan", () => {
    expect(() => parseCommand("scan", ["stray"])).toThrow(CliError);
  });

  it.each(KNOWN_COMMANDS)("accepts the known command %s with no arguments", (command) => {
    expect(parseCommand(command, [])).toEqual({ values: {}, positionals: [] });
  });

  it("rejects the removed --json flag", () => {
    expect(() => parseCommand("scan", ["--json"])).toThrow(/Unknown option '--json'/);
  });
});

describe("unknownCommandMessage", () => {
  it("suggests the nearest known command", () => {
    expect(unknownCommandMessage("scn")).toMatch(/did you mean 'scan'\?/i);
  });
  it("omits the suggestion when nothing is close", () => {
    expect(unknownCommandMessage("xyzzy")).not.toMatch(/did you mean/i);
  });
});
