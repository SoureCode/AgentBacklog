import { API_URL as REMOTE_API_URL, API_KEY as REMOTE_API_KEY } from "@sourecode/agent-backlog-core/config.js";

export async function remoteListProjects() {
  const res = await fetch(`${REMOTE_API_URL}/api/projects`);
  return res.json();
}

export async function remoteProxyRequest(path, req, res) {
  const url = `${REMOTE_API_URL}/api/projects${path}`;
  const headers = { "Content-Type": "application/json" };
  if (REMOTE_API_KEY) {
    headers.Authorization = `Bearer ${REMOTE_API_KEY}`;
  }

  const options = { method: req.method, headers };

  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => { data += chunk; });
      req.on("end", () => resolve(data));
    });
    if (body) options.body = body;
  }

  const upstream = await fetch(url, options);
  const contentType = upstream.headers.get("content-type") || "application/json";

  if (contentType.includes("text/event-stream")) {
    res.writeHead(upstream.status, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const reader = upstream.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); break; }
        res.write(value);
      }
    };
    pump().catch(() => res.end());
    req.on("close", () => { reader.cancel(); });
    return;
  }

  const data = await upstream.text();
  res.writeHead(upstream.status, { "Content-Type": contentType });
  res.end(data);
}
