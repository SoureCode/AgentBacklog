export class Router {
  #routes = [];

  #add(method, pattern, handler) {
    const keys = [];
    const src = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/:([^/]+)/g, (_, key) => { keys.push(key); return "([^/]+)"; });
    const regex = new RegExp(`^${src}$`);
    this.#routes.push({ method, regex, keys, handler });
  }

  get(pattern, handler)    { this.#add("GET",    pattern, handler); }
  post(pattern, handler)   { this.#add("POST",   pattern, handler); }
  patch(pattern, handler)  { this.#add("PATCH",  pattern, handler); }
  delete(pattern, handler) { this.#add("DELETE", pattern, handler); }

  async dispatch(req, res, pathname, ctx = {}) {
    for (const { method, regex, keys, handler } of this.#routes) {
      if (method !== req.method) continue;
      const m = pathname.match(regex);
      if (!m) continue;
      const params = Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      await handler(req, res, params, ctx);
      return true;
    }
    return false;
  }
}
