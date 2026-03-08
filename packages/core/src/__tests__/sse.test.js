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
  it("registers a client and sends initial snapshot", () => {
    const sse = new SSEBroadcaster("test");
    const res = mockRes();
    sse.register("proj", res, [{ id: 1 }]);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Content-Type": "text/event-stream" }));
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining(JSON.stringify([{ id: 1 }])));
  });

  it("broadcasts to registered clients", () => {
    const sse = new SSEBroadcaster("test");
    const res = mockRes();
    sse.register("proj", res, []);
    sse.broadcast("proj", [{ id: 2 }]);
    expect(res.write).toHaveBeenCalledTimes(2); // initial + broadcast
    const lastCall = res.write.mock.calls[1][0];
    expect(lastCall).toContain(JSON.stringify([{ id: 2 }]));
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

  it("broadcasts to multiple clients for same slug", () => {
    const sse = new SSEBroadcaster("test");
    const res1 = mockRes();
    const res2 = mockRes();
    sse.register("proj", res1, []);
    sse.register("proj", res2, []);
    sse.broadcast("proj", [{ id: 1 }]);
    expect(res1.write).toHaveBeenCalledTimes(2);
    expect(res2.write).toHaveBeenCalledTimes(2);
  });

  it("does not broadcast to other slugs", () => {
    const sse = new SSEBroadcaster("test");
    const res1 = mockRes();
    const res2 = mockRes();
    sse.register("proj-a", res1, []);
    sse.register("proj-b", res2, []);
    sse.broadcast("proj-a", []);
    expect(res1.write).toHaveBeenCalledTimes(2); // initial + broadcast
    expect(res2.write).toHaveBeenCalledTimes(1); // initial only
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
