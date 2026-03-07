const MAX_BODY_BYTES = 1_048_576; // 1 MB

export function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large (max 1 MB)"));
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (!body) { resolve({}); return; }
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

export function parsePositiveInt(str, name = "id") {
  const n = parseInt(str, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid ${name}: must be a positive integer`);
  return n;
}

export function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
