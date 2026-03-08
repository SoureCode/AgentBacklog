import { fullItem } from "@sourecode/agent-backlog-core/db/queries.js";

export function handleGetItem(stmts, id) {
  return { status: 200, body: fullItem(stmts, id) };
}
