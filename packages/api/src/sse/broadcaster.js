import { SSEBroadcaster } from "@sourecode/agent-backlog-core/http/sse.js";
import { getStoreForSlug } from "../store/store.js";

export const sse = new SSEBroadcaster("api");

export function broadcastProject(slug) {
  const store = getStoreForSlug(slug);
  sse.broadcast(slug, store.listItems());
}
