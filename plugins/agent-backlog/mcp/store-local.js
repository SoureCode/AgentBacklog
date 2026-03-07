import {
  openDatabase, closeDatabase, prepareStatements,
  now, requireItem, fullItem, allSummaries, summarize, deleteChecklistRecursive, wouldCycle,
  VersionConflictError, requireVersion, bumpVersion,
} from "./db.js";

export class LocalStore {
  constructor(dbPath) {
    this.db = openDatabase(dbPath);
    this.stmts = prepareStatements(this.db);
    this._tx = (fn) => this.db.transaction(fn)();
  }

  close() {
    closeDatabase(this.db);
  }

  listItems(status, { includeArchived = true } = {}) {
    return allSummaries(this.stmts, status, { includeArchived });
  }

  getItem(id) {
    return fullItem(this.stmts, id);
  }

  createItem({ title, description = "", status = "open" }) {
    const ts = now();
    const result = this.stmts.createItem.run(title, status, description, ts, ts);
    return fullItem(this.stmts, result.lastInsertRowid);
  }

  updateItem(id, { version, title, description, status }) {
    return this._tx(() => {
      const item = requireVersion(this.stmts, id, version);
      const result = this.stmts.updateItem.run(
        title ?? item.title,
        description ?? item.description,
        status ?? item.status,
        now(),
        id,
        version
      );
      if (result.changes === 0) {
        throw new VersionConflictError(id, version, fullItem(this.stmts, id));
      }
      return fullItem(this.stmts, id);
    });
  }

  searchItems(query, status, { includeArchived = true } = {}) {
    const tokens = [];
    const phraseRe = /"([^"]+)"|(\S+)/g;
    let m;
    while ((m = phraseRe.exec(query)) !== null) {
      tokens.push((m[1] ?? m[2]).toLowerCase());
    }

    let items;
    if (status) {
      items = this.stmts.listItemsByStatus.all(status);
    } else if (includeArchived) {
      items = this.stmts.listItems.all();
    } else {
      items = this.stmts.listItemsExcludeArchived.all();
    }
    const scored = [];

    for (const item of items) {
      const titleLower = item.title.toLowerCase();
      const descLower = item.description.toLowerCase();

      const allMatch = tokens.every((t) => titleLower.includes(t) || descLower.includes(t));
      if (!allMatch) continue;

      let score = 0;
      for (const t of tokens) {
        if (titleLower.includes(t)) score += 2;
        if (descLower.includes(t)) score += 1;
      }
      scored.push({ score, item });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => summarize(this.stmts, s.item));
  }

  addChecklist(item_id, { version, label, parent_id }) {
    return this._tx(() => {
      requireVersion(this.stmts, item_id, version);

      let position;
      if (parent_id !== undefined && parent_id !== null) {
        const parent = this.stmts.getChecklistItem.get(parent_id, item_id);
        if (!parent) throw new Error(`ChecklistItem ${parent_id} not found on BacklogItem ${item_id}`);
        position = this.stmts.countChecklistByParent.get(item_id, parent_id).cnt;
      } else {
        position = this.stmts.countTopChecklist.get(item_id).cnt;
      }

      const result = this.stmts.addChecklist.run(item_id, parent_id ?? null, label, position);
      bumpVersion(this.stmts, item_id, version);
      return {
        id: Number(result.lastInsertRowid),
        label,
        checked: false,
        position,
        children: [],
        item_version: version + 1,
      };
    });
  }

  updateChecklist(item_id, { version, id, label, checked }) {
    return this._tx(() => {
      requireVersion(this.stmts, item_id, version);
      const entry = this.stmts.getChecklistItem.get(id, item_id);
      if (!entry) throw new Error(`ChecklistItem ${id} not found on BacklogItem ${item_id}`);
      this.stmts.updateChecklist.run(
        label ?? entry.label,
        checked !== undefined ? (checked ? 1 : 0) : entry.checked,
        id
      );
      bumpVersion(this.stmts, item_id, version);
      const updated = this.stmts.getChecklistItem.get(id, item_id);
      return { ...updated, checked: !!updated.checked, item_version: version + 1 };
    });
  }

  deleteChecklist(item_id, { version, id }) {
    return this._tx(() => {
      requireVersion(this.stmts, item_id, version);
      const entry = this.stmts.getChecklistItem.get(id, item_id);
      if (!entry) throw new Error(`ChecklistItem ${id} not found on BacklogItem ${item_id}`);
      deleteChecklistRecursive(this.stmts, id);
      bumpVersion(this.stmts, item_id, version);
      return { deleted: id, item_version: version + 1 };
    });
  }

  addComment(item_id, { body }) {
    return this._tx(() => {
      const item = requireItem(this.stmts, item_id);
      const ts = now();
      const result = this.stmts.addComment.run(item_id, "agent", body, ts);
      bumpVersion(this.stmts, item_id, item.version);
      return { id: Number(result.lastInsertRowid), author: "agent", body, created_at: ts };
    });
  }

  addDependency(item_id, { version, depends_on_id }) {
    return this._tx(() => {
      if (item_id === depends_on_id) throw new Error("An item cannot depend on itself");
      requireVersion(this.stmts, item_id, version);
      requireItem(this.stmts, depends_on_id);

      if (wouldCycle(this.stmts, item_id, depends_on_id)) {
        throw new Error(`Adding this dependency would create a cycle: ${item_id} → ${depends_on_id}`);
      }

      this.stmts.addDep.run(item_id, depends_on_id);
      bumpVersion(this.stmts, item_id, version);
      return { item_id, depends_on_id, item_version: version + 1 };
    });
  }

  removeDependency(item_id, { version, depends_on_id }) {
    return this._tx(() => {
      requireVersion(this.stmts, item_id, version);
      const result = this.stmts.removeDep.run(item_id, depends_on_id);
      if (result.changes === 0) {
        throw new Error(`Dependency ${item_id} → ${depends_on_id} does not exist`);
      }
      bumpVersion(this.stmts, item_id, version);
      return { removed: { item_id, depends_on_id }, item_version: version + 1 };
    });
  }
}
