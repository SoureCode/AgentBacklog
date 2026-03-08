import { describe, it, expect, vi, beforeEach } from "vitest";
import { RemoteStore } from "../store/remote.js";
import { VersionConflictError, NotFoundError } from "../db/errors.js";

function makeStore(fetchFn) {
  const store = new RemoteStore("http://localhost:3000", "test-key");
  vi.stubGlobal("fetch", fetchFn);
  return store;
}

function mockResponse(status, body) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => "application/json" },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

beforeEach(() => { vi.unstubAllGlobals(); });

describe("RemoteStore — success paths", () => {
  it("lists items", async () => {
    const store = makeStore(() => mockResponse(200, [{ id: 1, title: "A" }]));
    const items = await store.listItems();
    expect(items).toEqual([{ id: 1, title: "A" }]);
  });

  it("gets a single item", async () => {
    const store = makeStore(() => mockResponse(200, { id: 1, title: "A", version: 1 }));
    const item = await store.getItem(1);
    expect(item.id).toBe(1);
  });

  it("creates an item", async () => {
    const store = makeStore(() => mockResponse(200, { id: 1, title: "New", version: 1 }));
    const item = await store.createItem({ title: "New" });
    expect(item.title).toBe("New");
  });
});

describe("RemoteStore — error handling", () => {
  it("throws NotFoundError on 404", async () => {
    const store = makeStore(() => mockResponse(404, { error: "BacklogItem 99 not found" }));
    await expect(store.getItem(99)).rejects.toThrow(NotFoundError);
  });

  it("throws VersionConflictError on 409", async () => {
    const store = makeStore(() => mockResponse(409, {
      id: 1,
      expectedVersion: 1,
      current: { id: 1, version: 2 },
    }));
    await expect(store.updateItem(1, { version: 1, title: "X" })).rejects.toThrow(VersionConflictError);
  });

  it("throws generic error on other non-ok status", async () => {
    const store = makeStore(() => mockResponse(500, { error: "Internal server error" }));
    await expect(store.listItems()).rejects.toThrow("Internal server error");
  });

  it("attaches status 504 on timeout", async () => {
    const store = makeStore(() => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });
    const caught = await store.listItems().catch(e => e);
    expect(caught.status).toBe(504);
    expect(caught.message).toMatch(/timed out/);
  });

  it("re-throws network errors as-is", async () => {
    const store = makeStore(() => Promise.reject(new Error("ECONNREFUSED")));
    await expect(store.listItems()).rejects.toThrow("ECONNREFUSED");
  });
});

describe("RemoteStore — all store methods return API data", () => {
  it("deleteItem resolves without error", async () => {
    const store = makeStore(() => mockResponse(200, { deleted: 1 }));
    await expect(store.deleteItem(1)).resolves.not.toThrow();
  });

  it("searchItems returns matching results", async () => {
    const store = makeStore(() => mockResponse(200, [{ id: 1, title: "login bug" }]));
    const results = await store.searchItems("login bug", "open");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("login bug");
  });

  it("addChecklist returns the created checklist item", async () => {
    const store = makeStore(() => mockResponse(200, { id: 7, label: "Step 1", checked: false }));
    const cl = await store.addChecklist(5, { version: 1, label: "Step 1" });
    expect(cl.id).toBe(7);
    expect(cl.label).toBe("Step 1");
    expect(cl.checked).toBe(false);
  });

  it("updateChecklist returns the updated checklist item", async () => {
    const store = makeStore(() => mockResponse(200, { id: 7, label: "Step 1", checked: true }));
    const cl = await store.updateChecklist(5, { version: 2, id: 7, checked: true });
    expect(cl.checked).toBe(true);
  });

  it("deleteChecklist resolves without error", async () => {
    const store = makeStore(() => mockResponse(200, { deleted: 7 }));
    await expect(store.deleteChecklist(5, { version: 2, id: 7 })).resolves.not.toThrow();
  });

  it("addComment returns the created comment", async () => {
    const store = makeStore(() => mockResponse(200, { id: 3, body: "A note", author: "agent" }));
    const comment = await store.addComment(5, { body: "A note" });
    expect(comment.body).toBe("A note");
    expect(comment.author).toBe("agent");
  });

  it("addDependency resolves without error", async () => {
    const store = makeStore(() => mockResponse(200, {}));
    await expect(store.addDependency(5, { version: 1, depends_on_id: 3 })).resolves.not.toThrow();
  });

  it("removeDependency resolves without error", async () => {
    const store = makeStore(() => mockResponse(200, {}));
    await expect(store.removeDependency(5, { version: 2, depends_on_id: 3 })).resolves.not.toThrow();
  });

  it("listItems excludes archived items when asked", async () => {
    const store = makeStore(() => mockResponse(200, [{ id: 1, status: "open" }]));
    const items = await store.listItems(null, { includeArchived: false });
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("open");
  });
});

describe("RemoteStore — branch coverage", () => {
  function makeTrackedStore(impl) {
    const fetchFn = vi.fn(impl);
    vi.stubGlobal("fetch", fetchFn);
    return { store: new RemoteStore("http://localhost:3000", "test-key"), fetchFn };
  }

  it("409 with missing body fields falls back to 0/{} defaults", async () => {
    const { store } = makeTrackedStore(() => mockResponse(409, {}));
    const err = await store.updateItem(1, { version: 1 }).catch(e => e);
    expect(err).toBeInstanceOf(VersionConflictError);
    expect(err.id).toBe(0);
    expect(err.expectedVersion).toBe(0);
    expect(err.currentItem).toEqual({});
  });

  it("404 with no error field in body uses 'Not found' fallback", async () => {
    const { store } = makeTrackedStore(() => mockResponse(404, {}));
    const err = await store.getItem(1).catch(e => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.message).toBe("Not found");
  });

  it("handles json() parse failure on non-ok response (catch branch)", async () => {
    const { store } = makeTrackedStore(() => Promise.resolve({
      status: 500,
      ok: false,
      headers: { get: () => "text/plain" },
      json: () => Promise.reject(new Error("not json")),
      text: () => Promise.resolve("Server Error"),
    }));
    await expect(store.listItems()).rejects.toThrow(/HTTP 500/);
  });

  it("searchItems with includeArchived=false appends exclude_archived", async () => {
    const { store, fetchFn } = makeTrackedStore(() => mockResponse(200, []));
    await store.searchItems("bug", null, { includeArchived: false });
    const url = fetchFn.mock.calls[0][0];
    expect(url).toContain("exclude_archived=1");
  });

  it("listItems with status and includeArchived=false sends both params", async () => {
    const { store, fetchFn } = makeTrackedStore(() => mockResponse(200, []));
    await store.listItems("open", { includeArchived: false });
    const url = fetchFn.mock.calls[0][0];
    expect(url).toContain("status=open");
    expect(url).toContain("exclude_archived=1");
  });
});

describe("RemoteStore — VersionConflictError fields", () => {
  it("populates id, expectedVersion, currentItem from 409 body", async () => {
    const current = { id: 5, version: 3, title: "Current" };
    const store = makeStore(() => mockResponse(409, { id: 5, expectedVersion: 2, current }));
    const err = await store.updateItem(5, { version: 2 }).catch(e => e);
    expect(err).toBeInstanceOf(VersionConflictError);
    expect(err.id).toBe(5);
    expect(err.expectedVersion).toBe(2);
    expect(err.currentItem).toEqual(current);
  });
});
