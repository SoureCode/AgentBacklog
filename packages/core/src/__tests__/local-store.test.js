import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "../store/local.js";
import { VersionConflictError, NotFoundError } from "../db/errors.js";

function makeStore() {
  return new LocalStore(":memory:");
}

describe("LocalStore — items", () => {
  let store;
  beforeEach(() => { store = makeStore(); });

  it("creates an item and returns it with version 1", () => {
    const item = store.createItem({ title: "Test" });
    expect(item.title).toBe("Test");
    expect(item.status).toBe("open");
    expect(item.version).toBe(1);
    expect(item.id).toBeTypeOf("number");
  });

  it("gets an item by id", () => {
    const created = store.createItem({ title: "Hello" });
    const fetched = store.getItem(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.title).toBe("Hello");
  });

  it("throws NotFoundError for missing item", () => {
    expect(() => store.getItem(999)).toThrow(NotFoundError);
  });

  it("lists items", () => {
    store.createItem({ title: "A" });
    store.createItem({ title: "B" });
    const items = store.listItems();
    expect(items.length).toBe(2);
  });

  it("filters list by status", () => {
    store.createItem({ title: "Open" });
    const item = store.createItem({ title: "Done" });
    store.updateItem(item.id, { version: 1, status: "done" });
    const open = store.listItems("open");
    expect(open.length).toBe(1);
    expect(open[0].title).toBe("Open");
  });

  it("updates item title and bumps version", () => {
    const item = store.createItem({ title: "Old" });
    const updated = store.updateItem(item.id, { version: 1, title: "New" });
    expect(updated.title).toBe("New");
    expect(updated.version).toBe(2);
  });

  it("throws VersionConflictError on stale update", () => {
    const item = store.createItem({ title: "X" });
    store.updateItem(item.id, { version: 1, title: "Y" });
    expect(() => store.updateItem(item.id, { version: 1, title: "Z" }))
      .toThrow(VersionConflictError);
  });

  it("searches items by title", () => {
    store.createItem({ title: "Fix the bug" });
    store.createItem({ title: "Add feature" });
    const results = store.searchItems("bug");
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Fix the bug");
  });

  it("soft-deletes item (archives it)", () => {
    const item = store.createItem({ title: "Delete me" });
    store.deleteItem(item.id);
    expect(() => store.getItem(item.id)).toThrow(NotFoundError);
  });
});

describe("LocalStore — checklist", () => {
  let store;
  let item;
  beforeEach(() => {
    store = makeStore();
    item = store.createItem({ title: "Parent" });
  });

  it("adds a checklist item", () => {
    const cl = store.addChecklist(item.id, { version: 1, label: "Step 1" });
    expect(cl.label).toBe("Step 1");
    expect(cl.checked).toBe(false);
    expect(cl.item_version).toBe(2);
  });

  it("updates a checklist item", () => {
    store.addChecklist(item.id, { version: 1, label: "Step 1" });
    const fetched = store.getItem(item.id);
    const clId = fetched.checklist[0].id;
    const updated = store.updateChecklist(item.id, { version: 2, id: clId, checked: true });
    expect(updated.checked).toBe(true);
  });

  it("rejects checklist add with stale version", () => {
    store.addChecklist(item.id, { version: 1, label: "Step 1" });
    expect(() => store.addChecklist(item.id, { version: 1, label: "Step 2" }))
      .toThrow(VersionConflictError);
  });

  it("enforces max nesting depth", () => {
    let currentId = null;
    let version = 1;
    // Build chain up to max depth (10 levels)
    for (let i = 0; i < 10; i++) {
      const cl = store.addChecklist(item.id, { version, label: `Level ${i}`, parent_id: currentId ?? undefined });
      currentId = cl.id;
      version = cl.item_version;
    }
    expect(() => store.addChecklist(item.id, { version, label: "Too deep", parent_id: currentId }))
      .toThrow(/maximum allowed depth/);
  });

  it("deletes a checklist item", () => {
    const cl = store.addChecklist(item.id, { version: 1, label: "Step 1" });
    store.deleteChecklist(item.id, { version: cl.item_version, id: cl.id });
    const fetched = store.getItem(item.id);
    expect(fetched.checklist.length).toBe(0);
  });
});

describe("LocalStore — dependencies", () => {
  let store;
  beforeEach(() => { store = makeStore(); });

  it("adds a dependency", () => {
    const a = store.createItem({ title: "A" });
    const b = store.createItem({ title: "B" });
    store.addDependency(b.id, { version: 1, depends_on_id: a.id });
    const fetched = store.getItem(b.id);
    expect(fetched.dependencies[0].depends_on_id).toBe(a.id);
  });

  it("rejects dependency cycles", () => {
    const a = store.createItem({ title: "A" });
    const b = store.createItem({ title: "B" });
    store.addDependency(b.id, { version: 1, depends_on_id: a.id });
    const aUpdated = store.getItem(a.id);
    expect(() => store.addDependency(a.id, { version: aUpdated.version, depends_on_id: b.id }))
      .toThrow(/cycle/i);
  });

  it("removes a dependency", () => {
    const a = store.createItem({ title: "A" });
    const b = store.createItem({ title: "B" });
    store.addDependency(b.id, { version: 1, depends_on_id: a.id });
    const bUpdated = store.getItem(b.id);
    store.removeDependency(b.id, { version: bUpdated.version, depends_on_id: a.id });
    const bFinal = store.getItem(b.id);
    expect(bFinal.dependencies.length).toBe(0);
  });
});

describe("LocalStore — comments", () => {
  let store;
  beforeEach(() => { store = makeStore(); });

  it("adds a comment", () => {
    const item = store.createItem({ title: "X" });
    store.addComment(item.id, { body: "Nice" });
    const fetched = store.getItem(item.id);
    expect(fetched.comments.length).toBe(1);
    expect(fetched.comments[0].body).toBe("Nice");
  });
});

describe("LocalStore — close()", () => {
  it("closes the database without error", () => {
    const store = makeStore();
    expect(() => store.close()).not.toThrow();
  });
});

describe("LocalStore — searchItems includeArchived", () => {
  it("returns archived items when includeArchived=true (default)", () => {
    const store = makeStore();
    const item = store.createItem({ title: "Alpha thing" });
    // Soft-archive by setting status to 'archived' (MCP soft-delete)
    store.updateItem(item.id, { version: 1, status: "archived" });
    const results = store.searchItems("thing", null, { includeArchived: true });
    expect(results.length).toBe(1);
  });

  it("excludes archived items when includeArchived=false", () => {
    const store = makeStore();
    const item = store.createItem({ title: "Beta thing" });
    store.updateItem(item.id, { version: 1, status: "archived" });
    const results = store.searchItems("thing", null, { includeArchived: false });
    expect(results.length).toBe(0);
  });

  it("filters by status when status is provided", () => {
    const store = makeStore();
    store.createItem({ title: "Gamma thing" });
    const results = store.searchItems("thing", "open");
    expect(results.length).toBe(1);
    expect(results[0].status).toBe("open");
  });
});

describe("LocalStore — removeDependency nonexistent", () => {
  it("throws when dependency does not exist", () => {
    const store = makeStore();
    const a = store.createItem({ title: "A" });
    const b = store.createItem({ title: "B" });
    expect(() => store.removeDependency(b.id, { version: 1, depends_on_id: a.id }))
      .toThrow(/does not exist/);
  });
});

describe("LocalStore — E2E: create → checklist → dependency → conflict → retry", () => {
  it("full workflow", () => {
    const store = makeStore();

    // Create two items
    const a = store.createItem({ title: "Task A" });
    const b = store.createItem({ title: "Task B" });

    // Add checklist to A
    const cl = store.addChecklist(a.id, { version: 1, label: "Do the thing" });
    expect(cl.item_version).toBe(2);

    // Add dependency: B depends on A
    store.addDependency(b.id, { version: 1, depends_on_id: a.id });

    // Simulate conflict: two concurrent updates to A
    const aFresh = store.getItem(a.id);
    store.updateItem(a.id, { version: aFresh.version, status: "in_progress" });

    // Stale update should conflict
    expect(() => store.updateItem(a.id, { version: aFresh.version, title: "Stale" }))
      .toThrow(VersionConflictError);

    // Re-fetch and retry
    const aRetry = store.getItem(a.id);
    const aFinal = store.updateItem(a.id, { version: aRetry.version, title: "Task A Updated" });
    expect(aFinal.title).toBe("Task A Updated");
    expect(aFinal.status).toBe("in_progress");
  });
});
