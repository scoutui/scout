import { describe, it, expect, beforeEach } from "vitest";
import { GovernanceTargetConflictError } from "../../src/storage.js";
import { PostgresDriver } from "../../src/drivers/postgres.js";
import { useDriverDatabase } from "../helpers/driver-db.js";
import { artifact, component, packageExport, resolvedAt, tag } from "../helpers/builders.js";
import { withReadModelDatabase } from "../../../../apps/web-app/tests/helpers/read-model-db.ts";
import { publishScan } from "../../../../apps/web-app/src/lib/scan-projection.ts";

describe.skipIf(!process.env.DATABASE_URL)("PostgresDriver governance", () => {
  const db = useDriverDatabase();
  const retired = (targetExport: string, reason: string) => ({
    grain: "component" as const, targetPackage: "@legacy/ui", targetExport, disposition: { kind: "retired" as const, reason },
  });
  beforeEach(async () => { await db.pool.query("DELETE FROM scan_jobs"); await db.pool.query("DELETE FROM governance"); });

  it("creates, lists, updates and deletes a governance record", async () => {
    const created = await db.driver.createGovernance({
      grain: "component",
      targetPackage: "@legacy/ui",
      targetExport: "Button",
      disposition: { kind: "superseded", by: { packageName: "@example/ui", exportName: "WebButton" } },
    });
    expect(created.id).toBeTruthy();
    expect(created.targetPackage).toBe("@legacy/ui");
    expect(created.targetExport).toBe("Button");

    const listed = await db.driver.listGovernance();
    expect(listed.map((r) => r.id)).toContain(created.id);

    const updated = await db.driver.updateGovernance(created.id, {
      grain: "component",
      targetPackage: "@legacy/ui",
      targetExport: "Button",
      disposition: { kind: "retired", reason: "css" },
    });
    expect(updated.id).toBe(created.id);
    expect(updated.disposition).toEqual({ kind: "retired", reason: "css" });

    await db.driver.deleteGovernance(created.id);
    expect((await db.driver.listGovernance()).find((r) => r.id === created.id)).toBeUndefined();
  });

  it("records who created a governance record and who last changed it, and keeps the record when an author's account goes", async () => {
    await db.pool.query(
      `INSERT INTO "user" (id, email) VALUES ('gov-author-a', 'gov-author-a@example.com'), ('gov-author-b', 'gov-author-b@example.com') ON CONFLICT (id) DO NOTHING`,
    );
    const authors = async (id: string) =>
      (await db.pool.query("SELECT created_by_user_id, updated_by_user_id FROM governance WHERE id = $1", [id])).rows;

    const created = await db.driver.createGovernance(retired("Button", "css"), "gov-author-a");
    expect(await authors(created.id)).toEqual([{ created_by_user_id: "gov-author-a", updated_by_user_id: "gov-author-a" }]);

    await db.driver.updateGovernance(created.id, retired("Button", "tokens"), "gov-author-b");
    expect(await authors(created.id)).toEqual([{ created_by_user_id: "gov-author-a", updated_by_user_id: "gov-author-b" }]);

    await db.pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [["gov-author-a", "gov-author-b"]]);
    expect(await authors(created.id)).toEqual([{ created_by_user_id: null, updated_by_user_id: null }]);
  });

  it("creating on an already-governed target throws instead of overwriting", async () => {
    await db.pool.query("DELETE FROM governance");
    const first = await db.driver.createGovernance({
      grain: "component", targetPackage: "@legacy/ui", targetExport: "Card",
      disposition: { kind: "retired", reason: "original" },
    });

    await expect(db.driver.createGovernance({
      grain: "component", targetPackage: "@legacy/ui", targetExport: "Card",
      disposition: { kind: "retired", reason: "clobber" },
    })).rejects.toBeInstanceOf(GovernanceTargetConflictError);

    // The original record is untouched.
    const rows = await db.driver.listGovernance();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first.id);
    expect(rows[0]?.disposition).toEqual({ kind: "retired", reason: "original" });
  });

  it("retargeting an edit onto another record's target throws instead of mutating it", async () => {
    await db.pool.query("DELETE FROM governance");
    const mine = await db.driver.createGovernance({
      grain: "component", targetPackage: "@legacy/ui", targetExport: "Mine",
      disposition: { kind: "retired", reason: "mine" },
    });
    const theirs = await db.driver.createGovernance({
      grain: "component", targetPackage: "@legacy/ui", targetExport: "Theirs",
      disposition: { kind: "retired", reason: "theirs" },
    });

    await expect(db.driver.updateGovernance(mine.id, {
      grain: "component", targetPackage: "@legacy/ui", targetExport: "Theirs",
      disposition: { kind: "retired", reason: "hijack" },
    })).rejects.toBeInstanceOf(GovernanceTargetConflictError);

    const rows = await db.driver.listGovernance();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === theirs.id)?.disposition).toEqual({ kind: "retired", reason: "theirs" });
  });

  it("updating a missing id throws", async () => {
    await db.pool.query("DELETE FROM governance");
    await expect(db.driver.updateGovernance("nope", {
      grain: "component", targetPackage: "@legacy/ui", targetExport: "Ghost",
      disposition: { kind: "retired", reason: "x" },
    })).rejects.toThrow(/nope/);
  });

  it("empty store lists nothing", async () => {
    await db.pool.query("DELETE FROM governance");
    expect(await db.driver.listGovernance()).toEqual([]);
  });

  it("queues one chart results job with each create, update and delete", async () => {
    const created = await db.driver.createGovernance(retired("Button", "first"));
    expect(await db.queuedResults()).toBe(1);
    await db.pool.query("DELETE FROM scan_jobs");
    await db.driver.updateGovernance(created.id, retired("Button", "second"));
    expect(await db.queuedResults()).toBe(1);
    await db.pool.query("DELETE FROM scan_jobs");
    await db.driver.deleteGovernance(created.id);
    expect(await db.queuedResults()).toBe(1);
  });

  it("a create on a governed target queues nothing", async () => {
    await db.driver.createGovernance(retired("Card", "original"));
    await db.pool.query("DELETE FROM scan_jobs");
    await expect(db.driver.createGovernance(retired("Card", "clobber"))).rejects.toBeInstanceOf(GovernanceTargetConflictError);
    expect(await db.queuedResults()).toBe(0);
  });

  it("an update onto another record's target queues nothing and leaves both records", async () => {
    const mine = await db.driver.createGovernance(retired("Mine", "mine"));
    await db.driver.createGovernance(retired("Theirs", "theirs"));
    await db.pool.query("DELETE FROM scan_jobs");
    await expect(db.driver.updateGovernance(mine.id, retired("Theirs", "hijack"))).rejects.toBeInstanceOf(GovernanceTargetConflictError);
    expect(await db.queuedResults()).toBe(0);
    expect((await db.driver.listGovernance()).map(record => record.disposition)).toEqual(expect.arrayContaining([
      { kind: "retired", reason: "mine" }, { kind: "retired", reason: "theirs" },
    ]));
  });
});

describe.skipIf(!process.env.DATABASE_URL)("PostgresDriver governance on the pages", () => {
  const disposition = { kind: "retired" as const, reason: "Use the new design system" };
  const retired = { status: "retired", reason: "Use the new design system" };

  it("marks a governed component deprecated on every page that shows it, and leaves its ungoverned neighbour active", async () => {
    await withReadModelDatabase(async pool => {
      const button = component(packageExport("@example/ui", "Button"));
      const card = component(packageExport("@example/ui", "Card"));
      const occurrences = [resolvedAt(button, "src/App.tsx", 1), resolvedAt(button, "src/App.tsx", 2), resolvedAt(card, "src/App.tsx", 3)];
      await publishScan(pool, artifact({ repoId: "sample-app", components: [button, card], occurrences }), { uploadedByUserId: null });
      const driver = new PostgresDriver(pool);
      const record = await driver.createGovernance({ grain: "component", targetPackage: "@example/ui", targetExport: "Button", disposition });
      const active = { status: "active" };
      expect(await driver.listRepos()).toMatchObject([{ repoId: "sample-app", deprecatedCount: 1 }]);
      expect(await driver.getComponentDetailHead("sample-app", button.id)).toMatchObject({ deprecated: true, migrationStatus: retired, governedByRecordId: record.id });
      expect(await driver.getComponentDetailHead("sample-app", card.id)).toMatchObject({ deprecated: false, migrationStatus: active, governedByRecordId: null });
      expect(await driver.listPackages()).toMatchObject([{ packageName: "@example/ui", deprecatedCount: 1 }]);
      expect(await driver.getPackage("@example/ui")).toMatchObject({
        deprecatedCount: 1,
        components: [{ componentId: button.id, deprecated: true }, { componentId: card.id, deprecated: false }],
      });
      expect(await driver.listComponents()).toMatchObject([{ componentId: button.id, deprecated: true }, { componentId: card.id, deprecated: false }]);
      expect(await driver.getCrossRepoComponent(button.id)).toMatchObject({
        deprecatedAnywhere: true, migrationStatus: retired, governedByRecordId: record.id, usages: [{ repoId: "sample-app", deprecated: true }],
      });
      expect(await driver.getCrossRepoComponent(card.id)).toMatchObject({
        deprecatedAnywhere: false, migrationStatus: active, governedByRecordId: null, usages: [{ repoId: "sample-app", deprecated: false }],
      });
    });
  });

  it("governs a tag through an older scan that attributes it to a package, when the newest scan leaves it unattributed", async () => {
    await withReadModelDatabase(async pool => {
      const attributed = component(tag("x-card"), { attribution: { status: "resolved", target: { kind: "package", packageName: "@example/ui" }, confidence: "observed", evidence: [] } });
      const unattributed = component(tag("x-card"), { attribution: { status: "unknown", reason: "absent", evidence: [] } });
      await publishScan(pool, artifact({ repoId: "repo-a", scanId: "older", scannedAt: "2026-06-01T00:00:00.000Z", components: [attributed], occurrences: [resolvedAt(attributed, "src/App.tsx")] }), { uploadedByUserId: null });
      await publishScan(pool, artifact({ repoId: "repo-b", scanId: "newer", scannedAt: "2026-06-02T00:00:00.000Z", components: [unattributed], occurrences: [resolvedAt(unattributed, "src/App.tsx")] }), { uploadedByUserId: null });
      const driver = new PostgresDriver(pool);
      const record = await driver.createGovernance({ grain: "component", targetPackage: "@example/ui", targetExport: "x-card", disposition });
      expect(await driver.getCrossRepoComponent(attributed.id)).toMatchObject({
        packageName: null,
        migrationStatus: retired,
        governedByRecordId: record.id,
        usages: [{ repoId: "repo-a", deprecated: true }, { repoId: "repo-b", deprecated: false }],
      });
    });
  });
});
