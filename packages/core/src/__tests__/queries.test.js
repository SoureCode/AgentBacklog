import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "../db/schema.js";
import { prepareStatements } from "../db/statements.js";
import {
  now, requireItem, buildChecklistTree, fullItem, allSummaries, summarize,
  wouldCycle, requireVersion, bumpVersion, CHECKLIST_MAX_DEPTH,
} from "../db/queries.js";
import { NotFoundError, VersionConflictError } from "../db/errors.js";

function makeDb() {
  const db = openDatabase(":memory:");
  const stmts = prepareStatements(db);
  return { db, stmts };
}

function createItem(stmts, title = "Test", status = "open") {
  const ts = now();
  const result = stmts.createItem.run(title, status, "", ts, ts);
  return stmts.getItem.get(result.lastInsertRowid);
}

describe("now()", () => {
  it("returns an ISO string", () => {
    const ts = now();
    expect(new Date(ts).toISOString()).toBe(ts);
  });
});

describe("requireItem()", () => {
  it("returns item when found", () => {
    const { stmts } = makeDb();
    const item = createItem(stmts);
    expect(requireItem(stmts, item.id).id).toBe(item.id);
  });

  it("throws NotFoundError when missing", () => {
    const { stmts } = makeDb();
    expect(() => requireItem(stmts, 999)).toThrow(NotFoundError);
  });
});

describe("requireVersion()", () => {
  it("passes when version matches", () => {
    const { stmts } = makeDb();
    const item = createItem(stmts);
    expect(() => requireVersion(stmts, item.id, item.version)).not.toThrow();
  });

  it("throws VersionConflictError when version is stale", () => {
    const { stmts } = makeDb();
    const item = createItem(stmts);
    expect(() => requireVersion(stmts, item.id, 99)).toThrow(VersionConflictError);
  });
});

describe("bumpVersion()", () => {
  it("increments version", () => {
    const { stmts } = makeDb();
    const item = createItem(stmts);
    bumpVersion(stmts, item.id, item.version);
    const updated = stmts.getItem.get(item.id);
    expect(updated.version).toBe(item.version + 1);
  });

  it("throws VersionConflictError on concurrent bump", () => {
    const { stmts } = makeDb();
    const item = createItem(stmts);
    bumpVersion(stmts, item.id, item.version);
    expect(() => bumpVersion(stmts, item.id, item.version)).toThrow(VersionConflictError);
  });
});

describe("buildChecklistTree()", () => {
  it("returns empty array for item with no checklist", () => {
    const { stmts } = makeDb();
    const item = createItem(stmts);
    expect(buildChecklistTree(stmts, item.id, null)).toEqual([]);
  });

  it("throws when depth exceeds max", () => {
    const { stmts } = makeDb();
    const item = createItem(stmts);
    // Insert checklist items directly at exactly max depth
    let parentId = null;
    for (let i = 0; i < CHECKLIST_MAX_DEPTH; i++) {
      const r = stmts.addChecklist.run(item.id, parentId, `level ${i}`, i);
      parentId = Number(r.lastInsertRowid);
    }
    // Reading this tree should throw
    expect(() => buildChecklistTree(stmts, item.id, null)).toThrow(/maximum allowed depth/);
  });
});

describe("fullItem()", () => {
  it("returns item with checklist, dependencies, comments arrays", () => {
    const { stmts } = makeDb();
    const item = createItem(stmts);
    const full = fullItem(stmts, item.id);
    expect(full.checklist).toBeInstanceOf(Array);
    expect(full.dependencies).toBeInstanceOf(Array);
    expect(full.comments).toBeInstanceOf(Array);
  });
});

describe("allSummaries()", () => {
  it("returns all items when no filter", () => {
    const { stmts } = makeDb();
    createItem(stmts, "A", "open");
    createItem(stmts, "B", "done");
    expect(allSummaries(stmts).length).toBe(2);
  });

  it("filters by status", () => {
    const { stmts } = makeDb();
    createItem(stmts, "A", "open");
    createItem(stmts, "B", "done");
    expect(allSummaries(stmts, "open").length).toBe(1);
  });

  it("excludes archived when includeArchived is false", () => {
    const { stmts } = makeDb();
    const item = createItem(stmts, "A", "open");
    stmts.updateItem.run("A", "", "archived", now(), item.id, item.version);
    expect(allSummaries(stmts, null, { includeArchived: false }).length).toBe(0);
    expect(allSummaries(stmts, null, { includeArchived: true }).length).toBe(1);
  });
});

describe("wouldCycle()", () => {
  it("returns false when no cycle", () => {
    const { stmts } = makeDb();
    const a = createItem(stmts, "A");
    const b = createItem(stmts, "B");
    expect(wouldCycle(stmts, b.id, a.id)).toBe(false);
  });

  it("returns true for direct cycle", () => {
    const { stmts } = makeDb();
    const a = createItem(stmts, "A");
    const b = createItem(stmts, "B");
    // B depends on A
    stmts.addDep.run(b.id, a.id);
    // Now check if A depending on B would cycle
    expect(wouldCycle(stmts, a.id, b.id)).toBe(true);
  });

  it("returns true for transitive cycle", () => {
    const { stmts } = makeDb();
    const a = createItem(stmts, "A");
    const b = createItem(stmts, "B");
    const c = createItem(stmts, "C");
    stmts.addDep.run(b.id, a.id); // B -> A
    stmts.addDep.run(c.id, b.id); // C -> B
    // A -> C would create A -> C -> B -> A
    expect(wouldCycle(stmts, a.id, c.id)).toBe(true);
  });
});
