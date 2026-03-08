import { NotFoundError, VersionConflictError } from "./errors.js";

// ── query helpers ─────────────────────────────────────────────────────────

export function now() {
  return new Date().toISOString();
}

export function requireItem(stmts, id) {
  const item = stmts.getItem.get(id);
  if (!item) throw new NotFoundError(id);
  return item;
}

export const CHECKLIST_MAX_DEPTH = 10;

export function buildChecklistTree(stmts, itemId, parentId, depth = 0, maxDepth = CHECKLIST_MAX_DEPTH) {
  if (depth >= maxDepth) {
    throw new Error(
      `Checklist nesting exceeds maximum allowed depth of ${maxDepth}. ` +
      `Restructure the checklist to reduce nesting.`
    );
  }

  const rows = parentId === null
    ? stmts.getTopChecklist.all(itemId)
    : stmts.getChecklistByParent.all(itemId, parentId);

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    checked: !!row.checked,
    position: row.position,
    children: buildChecklistTree(stmts, itemId, row.id, depth + 1, maxDepth),
  }));
}

export function fullItem(stmts, id) {
  const item = requireItem(stmts, id);
  return {
    ...item,
    checklist: buildChecklistTree(stmts, item.id, null),
    dependencies: stmts.getDeps.all(item.id).map((d) => ({ depends_on_id: d.depends_on_id })),
    comments: stmts.getComments.all(item.id),
  };
}

export function summarize(stmts, item) {
  const total = stmts.countChecklistTotal.get(item.id).cnt;
  const done = stmts.countChecklistDone.get(item.id).cnt;
  const comments = stmts.countComments.get(item.id).cnt;
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    version: item.version,
    updated_at: item.updated_at,
    dependencies: stmts.getDeps.all(item.id).map((d) => d.depends_on_id),
    checklist: total > 0 ? { total, done } : undefined,
    comments: comments > 0 ? comments : undefined,
  };
}

export function allSummaries(stmts, status, { includeArchived = true } = {}) {
  let items;
  if (status) {
    items = stmts.listItemsByStatus.all(status);
  } else if (includeArchived) {
    items = stmts.listItems.all();
  } else {
    items = stmts.listItemsExcludeArchived.all();
  }
  return items.map((item) => summarize(stmts, item));
}

export function deleteChecklistRecursive(stmts, id) {
  const children = stmts.getChecklistChildren.all(id);
  for (const child of children) {
    deleteChecklistRecursive(stmts, child.id);
  }
  stmts.deleteChecklist.run(id);
}

export function wouldCycle(stmts, fromId, toId) {
  const visited = new Set();
  const stack = [toId];
  while (stack.length) {
    const node = stack.pop();
    if (node === fromId) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const dep of stmts.getDeps.all(node)) {
      stack.push(dep.depends_on_id);
    }
  }
  return false;
}

// ── optimistic locking ────────────────────────────────────────────────────

export function requireVersion(stmts, id, version) {
  const item = requireItem(stmts, id);
  if (item.version !== version) {
    throw new VersionConflictError(id, version, { ...item, checklist: [], dependencies: [], comments: [] });
  }
  return item;
}

export function bumpVersion(stmts, id, version) {
  const result = stmts.touchItem.run(now(), id, version);
  if (result.changes === 0) {
    throw new VersionConflictError(id, version, fullItem(stmts, id));
  }
}
