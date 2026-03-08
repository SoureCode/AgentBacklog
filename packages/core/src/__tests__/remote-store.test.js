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
