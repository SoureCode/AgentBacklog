import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@sourecode/agent-backlog-core/store/local.js";
import { VersionConflictError, NotFoundError } from "@sourecode/agent-backlog-core/db/errors.js";
import { registerItemTools } from "../tools/items.js";
import { registerChecklistTools } from "../tools/checklists.js";
import { registerCommentTools } from "../tools/comments.js";
import { registerDependencyTools } from "../tools/dependencies.js";

function makeHandlers() {
  const store = new LocalStore(":memory:");
  const handlers = {};
  const tool = (_name, _desc, _schema, handler) => { handlers[_name] = handler; };
  const ok = (data) => data;

  registerItemTools(null, store, tool, ok);
  registerChecklistTools(null, store, tool, ok);
  registerCommentTools(null, store, tool, ok);
  registerDependencyTools(null, store, tool, ok);

  return { handlers, store };
}

describe("backlog_list", () => {
  it("returns empty list initially", async () => {
    const { handlers } = makeHandlers();
    expect(await handlers.backlog_list({})).toEqual([]);
  });

  it("returns created items", async () => {
    const { handlers } = makeHandlers();
    await handlers.backlog_create({ title: "Test" });
    const items = await handlers.backlog_list({});
    expect(items.length).toBe(1);
    expect(items[0].title).toBe("Test");
  });

  it("filters by status", async () => {
    const { handlers } = makeHandlers();
    const item = await handlers.backlog_create({ title: "Task" });
    await handlers.backlog_update({ id: item.id, version: item.version, status: "done" });
    expect(await handlers.backlog_list({ status: "open" })).toHaveLength(0);
    expect(await handlers.backlog_list({ status: "done" })).toHaveLength(1);
  });

  it("excludes archived items", async () => {
    const { handlers } = makeHandlers();
    const item = await handlers.backlog_create({ title: "Task" });
    await handlers.backlog_delete({ id: item.id, version: item.version });
    expect(await handlers.backlog_list({})).toHaveLength(0);
  });
});

describe("backlog_get", () => {
  it("returns item by id", async () => {
    const { handlers } = makeHandlers();
    const item = await handlers.backlog_create({ title: "Hello" });
    const fetched = await handlers.backlog_get({ id: item.id });
    expect(fetched.id).toBe(item.id);
    expect(fetched.title).toBe("Hello");
  });

  it("throws NotFoundError for missing item", async () => {
    const { handlers } = makeHandlers();
    await expect(handlers.backlog_get({ id: 999 })).rejects.toThrow(NotFoundError);
  });

  it("accepts id as string (coercion)", async () => {
    const { handlers } = makeHandlers();
    const item = await handlers.backlog_create({ title: "Coerce" });
    const fetched = await handlers.backlog_get({ id: String(item.id) });
    expect(fetched.id).toBe(item.id);
  });
});

describe("backlog_create", () => {
  it("creates with version 1", async () => {
    const { handlers } = makeHandlers();
    const item = await handlers.backlog_create({ title: "New" });
    expect(item.version).toBe(1);
    expect(item.status).toBe("open");
  });

  it("accepts optional description and status", async () => {
    const { handlers } = makeHandlers();
    const item = await handlers.backlog_create({ title: "T", description: "Desc", status: "in_progress" });
    expect(item.description).toBe("Desc");
    expect(item.status).toBe("in_progress");
  });
});

describe("backlog_update", () => {
  it("updates title and bumps version", async () => {
    const { handlers } = makeHandlers();
    const item = await handlers.backlog_create({ title: "Old" });
    const updated = await handlers.backlog_update({ id: item.id, version: 1, title: "New" });
    expect(updated.title).toBe("New");
    expect(updated.version).toBe(2);
  });

  it("throws VersionConflictError on stale version", async () => {
    const { handlers } = makeHandlers();
    const item = await handlers.backlog_create({ title: "X" });
    await handlers.backlog_update({ id: item.id, version: 1, title: "Y" });
    await expect(handlers.backlog_update({ id: item.id, version: 1, title: "Z" }))
      .rejects.toThrow(VersionConflictError);
  });
});

describe("backlog_delete", () => {
  it("archives item so it disappears from list", async () => {
    const { handlers } = makeHandlers();
    const item = await handlers.backlog_create({ title: "Gone" });
    await handlers.backlog_delete({ id: item.id, version: 1 });
    // Archived items are hidden from agents via backlog_list
    const list = await handlers.backlog_list({});
    expect(list.find(i => i.id === item.id)).toBeUndefined();
  });
});

describe("backlog_search", () => {
  it("finds items by keyword", async () => {
    const { handlers } = makeHandlers();
    await handlers.backlog_create({ title: "Fix the login bug" });
    await handlers.backlog_create({ title: "Add feature" });
    const results = await handlers.backlog_search({ query: "login" });
    expect(results.length).toBe(1);
  });
});

describe("checklist_add", () => {
  it("adds checklist item and bumps version", async () => {
    const { handlers } = makeHandlers();
    const item = await handlers.backlog_create({ title: "T" });
    const cl = await handlers.checklist_add({ item_id: item.id, version: 1, label: "Step 1" });
    expect(cl.label).toBe("Step 1");
    expect(cl.item_version).toBe(2);
  });
});

describe("checklist_update", () => {
  it("marks checklist item checked", async () => {
    const { handlers } = makeHandlers();
    const item = await handlers.backlog_create({ title: "T" });
    const cl = await handlers.checklist_add({ item_id: item.id, version: 1, label: "Step 1" });
    const updated = await handlers.checklist_update({ item_id: item.id, version: cl.item_version, id: cl.id, checked: true });
    expect(updated.checked).toBe(true);
  });
});

describe("checklist_delete", () => {
  it("removes a checklist item", async () => {
    const { handlers } = makeHandlers();
    const item = await handlers.backlog_create({ title: "T" });
    const cl = await handlers.checklist_add({ item_id: item.id, version: 1, label: "Step 1" });
    await handlers.checklist_delete({ item_id: item.id, version: cl.item_version, id: cl.id });
    const fetched = await handlers.backlog_get({ id: item.id });
    expect(fetched.checklist.length).toBe(0);
  });
});

describe("comment_add", () => {
  it("adds a comment", async () => {
    const { handlers } = makeHandlers();
    const item = await handlers.backlog_create({ title: "T" });
    await handlers.comment_add({ item_id: item.id, body: "A note" });
    const fetched = await handlers.backlog_get({ id: item.id });
    expect(fetched.comments[0].body).toBe("A note");
  });
});

describe("dependency_add + dependency_remove", () => {
  it("adds and removes a dependency", async () => {
    const { handlers } = makeHandlers();
    const a = await handlers.backlog_create({ title: "A" });
    const b = await handlers.backlog_create({ title: "B" });
    await handlers.dependency_add({ item_id: b.id, version: 1, depends_on_id: a.id });
    let bFetched = await handlers.backlog_get({ id: b.id });
    expect(bFetched.dependencies.length).toBe(1);

    await handlers.dependency_remove({ item_id: b.id, version: bFetched.version, depends_on_id: a.id });
    bFetched = await handlers.backlog_get({ id: b.id });
    expect(bFetched.dependencies.length).toBe(0);
  });

  it("rejects cycles", async () => {
    const { handlers } = makeHandlers();
    const a = await handlers.backlog_create({ title: "A" });
    const b = await handlers.backlog_create({ title: "B" });
    await handlers.dependency_add({ item_id: b.id, version: 1, depends_on_id: a.id });
    const aFresh = await handlers.backlog_get({ id: a.id });
    await expect(handlers.dependency_add({ item_id: a.id, version: aFresh.version, depends_on_id: b.id }))
      .rejects.toThrow(/cycle/i);
  });
});
