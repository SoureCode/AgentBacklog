import { VersionConflictError } from "./db.js";
import { logger } from "./logger.js";

export class RemoteStore {
  constructor(apiUrl, apiKey) {
    this.apiUrl = apiUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  close() {
    // no-op for remote
  }

  async _fetch(path, options = {}) {
    const url = `${this.apiUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...options.headers,
      },
    });

    if (res.status === 409) {
      const body = await res.json();
      throw new VersionConflictError(
        body.id ?? 0,
        body.expectedVersion ?? 0,
        body.current ?? {}
      );
    }

    if (res.status === 404) {
      const body = await res.json();
      const err = new Error(body.error || "Not found");
      logger.warn("remote:not-found", { path, error: err.message });
      throw err;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error || `HTTP ${res.status}`);
      logger.error("remote:http-error", { path, status: res.status, error: err.message });
      throw err;
    }

    return res.json();
  }

  async listItems(status) {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return this._fetch(`/api/items${qs}`);
  }

  async getItem(id) {
    return this._fetch(`/api/items/${id}`);
  }

  async createItem({ title, description, status }) {
    return this._fetch("/api/items", {
      method: "POST",
      body: JSON.stringify({ title, description, status }),
    });
  }

  async updateItem(id, { version, title, description, status }) {
    return this._fetch(`/api/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ version, title, description, status }),
    });
  }

  async searchItems(query, status) {
    let qs = `?q=${encodeURIComponent(query)}`;
    if (status) qs += `&status=${encodeURIComponent(status)}`;
    return this._fetch(`/api/search${qs}`);
  }

  async addChecklist(item_id, { version, label, parent_id }) {
    return this._fetch(`/api/items/${item_id}/checklist`, {
      method: "POST",
      body: JSON.stringify({ version, label, parent_id }),
    });
  }

  async updateChecklist(item_id, { version, id, label, checked }) {
    return this._fetch(`/api/items/${item_id}/checklist/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ version, label, checked }),
    });
  }

  async deleteChecklist(item_id, { version, id }) {
    return this._fetch(`/api/items/${item_id}/checklist/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ version }),
    });
  }

  async addComment(item_id, { body }) {
    return this._fetch(`/api/items/${item_id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  async addDependency(item_id, { version, depends_on_id }) {
    return this._fetch(`/api/items/${item_id}/dependencies`, {
      method: "POST",
      body: JSON.stringify({ version, depends_on_id }),
    });
  }

  async removeDependency(item_id, { version, depends_on_id }) {
    return this._fetch(`/api/items/${item_id}/dependencies/${depends_on_id}`, {
      method: "DELETE",
      body: JSON.stringify({ version }),
    });
  }
}
