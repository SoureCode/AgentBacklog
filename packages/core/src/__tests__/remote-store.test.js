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

describe("RemoteStore — remaining store methods", () => {
  function makeTrackedStore(impl) {
    const fetchFn = vi.fn(impl);
    vi.stubGlobal("fetch", fetchFn);
    return { store: new RemoteStore("http://localhost:3000", "test-key"), fetchFn };
  }

  it("deleteItem sends DELETE", async () => {
    const { store, fetchFn } = makeTrackedStore(() => mockResponse(200, {}));
    await store.deleteItem(1);
    expect(fetchFn.mock.calls[0][1].method).toBe("DELETE");
  });

  it("searchItems builds correct query string", async () => {
    const { store, fetchFn } = makeTrackedStore(() => mockResponse(200, []));
    await store.searchItems("login bug", "open");
    const url = fetchFn.mock.calls[0][0];
    expect(url).toContain("q=login%20bug");
    expect(url).toContain("status=open");
  });

  it("addChecklist sends POST to checklist endpoint", async () => {
    const { store, fetchFn } = makeTrackedStore(() => mockResponse(200, { id: 1, label: "Step" }));
    const result = await store.addChecklist(5, { version: 1, label: "Step" });
    expect(result.label).toBe("Step");
    expect(fetchFn.mock.calls[0][0]).toContain("/api/items/5/checklist");
  });

  it("updateChecklist sends PATCH", async () => {
    const { store, fetchFn } = makeTrackedStore(() => mockResponse(200, { id: 1, checked: true }));
    const result = await store.updateChecklist(5, { version: 2, id: 1, checked: true });
    expect(fetchFn.mock.calls[0][1].method).toBe("PATCH");
    expect(result.checked).toBe(true);
  });

  it("deleteChecklist sends DELETE to checklist item endpoint", async () => {
    const { store, fetchFn } = makeTrackedStore(() => mockResponse(200, {}));
    await store.deleteChecklist(5, { version: 2, id: 1 });
    expect(fetchFn.mock.calls[0][1].method).toBe("DELETE");
    expect(fetchFn.mock.calls[0][0]).toContain("/api/items/5/checklist/1");
  });

  it("addComment sends POST to comments endpoint", async () => {
    const { store, fetchFn } = makeTrackedStore(() => mockResponse(200, { id: 1, body: "Note" }));
    const result = await store.addComment(5, { body: "Note" });
    expect(result.body).toBe("Note");
    expect(fetchFn.mock.calls[0][0]).toContain("/api/items/5/comments");
  });

  it("addDependency sends POST to dependencies endpoint", async () => {
    const { store, fetchFn } = makeTrackedStore(() => mockResponse(200, {}));
    await store.addDependency(5, { version: 1, depends_on_id: 3 });
    expect(fetchFn.mock.calls[0][0]).toContain("/api/items/5/dependencies");
  });

  it("removeDependency sends DELETE to dependency endpoint", async () => {
    const { store, fetchFn } = makeTrackedStore(() => mockResponse(200, {}));
    await store.removeDependency(5, { version: 2, depends_on_id: 3 });
    expect(fetchFn.mock.calls[0][1].method).toBe("DELETE");
    expect(fetchFn.mock.calls[0][0]).toContain("/api/items/5/dependencies/3");
  });

  it("listItems with includeArchived=false appends exclude_archived param", async () => {
    const { store, fetchFn } = makeTrackedStore(() => mockResponse(200, []));
    await store.listItems(null, { includeArchived: false });
    expect(fetchFn.mock.calls[0][0]).toContain("exclude_archived=1");
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
