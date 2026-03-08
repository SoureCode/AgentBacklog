import { describe, it, expect, vi } from "vitest";
import { SSEBroadcaster } from "../http/sse.js";

function mockRes() {
  return {
    writableEnded: false,
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  };
}

describe("SSEBroadcaster", () => {
  it("sends initial snapshot data to a newly registered client", () => {
    const sse = new SSEBroadcaster("test");
    const res = mockRes();
    sse.register("proj", res, [{ id: 1, title: "Task" }]);
    const written = res.write.mock.calls.map(c => c[0]).join("");
    expect(written).toContain(JSON.stringify([{ id: 1, title: "Task" }]));
  });

  it("delivers broadcast data to registered clients", () => {
    const sse = new SSEBroadcaster("test");
    const res = mockRes();
    sse.register("proj", res, []);
    sse.broadcast("proj", [{ id: 2, title: "Updated" }]);
    const written = res.write.mock.calls.map(c => c[0]).join("");
    expect(written).toContain(JSON.stringify([{ id: 2, title: "Updated" }]));
  });

  it("skips clients with writableEnded", () => {
    const sse = new SSEBroadcaster("test");
    const res = mockRes();
    sse.register("proj", res, []);
    res.writableEnded = true;
    sse.broadcast("proj", []);
    expect(sse.clientCount("proj")).toBe(0);
  });

  it("removes client on write error", () => {
    const sse = new SSEBroadcaster("test");
    const res = mockRes();
    sse.register("proj", res, []);
    // Override write to throw on the next (broadcast) call
    res.write.mockImplementation(() => { throw new Error("socket hang up"); });
    sse.broadcast("proj", []);
    expect(sse.clientCount("proj")).toBe(0);
  });

  it("cleanup function removes the client", () => {
    const sse = new SSEBroadcaster("test");
    const res = mockRes();
    const cleanup = sse.register("proj", res, []);
    expect(sse.clientCount("proj")).toBe(1);
    cleanup();
    expect(sse.clientCount("proj")).toBe(0);
  });

  it("delivers broadcast to all clients subscribed to the same project", () => {
    const sse = new SSEBroadcaster("test");
    const res1 = mockRes();
    const res2 = mockRes();
    sse.register("proj", res1, []);
    sse.register("proj", res2, []);
    sse.broadcast("proj", [{ id: 1, title: "Task" }]);
    const written1 = res1.write.mock.calls.map(c => c[0]).join("");
    const written2 = res2.write.mock.calls.map(c => c[0]).join("");
    expect(written1).toContain(JSON.stringify([{ id: 1, title: "Task" }]));
    expect(written2).toContain(JSON.stringify([{ id: 1, title: "Task" }]));
  });

  it("does not deliver a project's broadcast to clients of a different project", () => {
    const sse = new SSEBroadcaster("test");
    const res1 = mockRes();
    const res2 = mockRes();
    sse.register("proj-a", res1, []);
    sse.register("proj-b", res2, []);
    sse.broadcast("proj-a", [{ id: 99 }]);
    const writtenB = res2.write.mock.calls.map(c => c[0]).join("");
    expect(writtenB).not.toContain(JSON.stringify([{ id: 99 }]));
  });

  it("closeAll ends all connections and clears state", () => {
    const sse = new SSEBroadcaster("test");
    const res1 = mockRes();
    const res2 = mockRes();
    sse.register("a", res1, []);
    sse.register("b", res2, []);
    sse.closeAll();
    expect(res1.end).toHaveBeenCalled();
    expect(res2.end).toHaveBeenCalled();
    expect(sse.clientCount("a")).toBe(0);
    expect(sse.clientCount("b")).toBe(0);
  });

  it("cleanup is a no-op when slug no longer exists in clients map", () => {
    const sse = new SSEBroadcaster("test");
    const res = mockRes();
    const cleanup = sse.register("proj", res, []);
    // Manually clear the clients map to simulate slug being removed
    sse.clients.clear();
    // Should not throw even with optional chaining path
    expect(() => cleanup()).not.toThrow();
  });

  it("activeSlugs returns slugs with clients", () => {
    const sse = new SSEBroadcaster("test");
    sse.register("x", mockRes(), []);
    sse.register("y", mockRes(), []);
    expect([...sse.activeSlugs()]).toEqual(expect.arrayContaining(["x", "y"]));
  });
});
