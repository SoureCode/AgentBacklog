import { json } from "@sourecode/agent-backlog-core/http/helpers.js";

export async function handleHealth(req, res) {
  json(res, 200, { status: "ok" });
}
