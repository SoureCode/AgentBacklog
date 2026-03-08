// ── prepared statements factory ───────────────────────────────────────────

export function prepareStatements(db) {
  return {
    listItems: db.prepare("SELECT * FROM items ORDER BY id"),
    listItemsExcludeArchived: db.prepare("SELECT * FROM items WHERE status != 'archived' ORDER BY id"),
    listItemsByStatus: db.prepare("SELECT * FROM items WHERE status = ? ORDER BY id"),
    getItem: db.prepare("SELECT * FROM items WHERE id = ?"),
    createItem: db.prepare(
      "INSERT INTO items (title, status, description, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
    ),
    updateItem: db.prepare(
      "UPDATE items SET title = ?, description = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?"
    ),
    touchItem: db.prepare(
      "UPDATE items SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?"
    ),

    getChecklistItem: db.prepare("SELECT * FROM checklist_items WHERE id = ? AND item_id = ?"),
    getChecklistByParent: db.prepare(
      "SELECT * FROM checklist_items WHERE item_id = ? AND parent_id = ? ORDER BY position"
    ),
    getTopChecklist: db.prepare(
      "SELECT * FROM checklist_items WHERE item_id = ? AND parent_id IS NULL ORDER BY position"
    ),
    countChecklistByParent: db.prepare(
      "SELECT COUNT(*) as cnt FROM checklist_items WHERE item_id = ? AND parent_id = ?"
    ),
    countTopChecklist: db.prepare(
      "SELECT COUNT(*) as cnt FROM checklist_items WHERE item_id = ? AND parent_id IS NULL"
    ),
    addChecklist: db.prepare(
      "INSERT INTO checklist_items (item_id, parent_id, label, checked, position) VALUES (?, ?, ?, 0, ?)"
    ),
    updateChecklist: db.prepare(
      "UPDATE checklist_items SET label = ?, checked = ? WHERE id = ?"
    ),
    deleteChecklist: db.prepare("DELETE FROM checklist_items WHERE id = ?"),
    getChecklistChildren: db.prepare("SELECT id FROM checklist_items WHERE parent_id = ?"),

    addComment: db.prepare(
      "INSERT INTO comments (item_id, author, body, created_at) VALUES (?, ?, ?, ?)"
    ),
    getComments: db.prepare("SELECT * FROM comments WHERE item_id = ? ORDER BY created_at"),
    countComments: db.prepare("SELECT COUNT(*) as cnt FROM comments WHERE item_id = ?"),

    getDeps: db.prepare("SELECT depends_on_id FROM dependencies WHERE item_id = ?"),
    addDep: db.prepare("INSERT OR IGNORE INTO dependencies (item_id, depends_on_id) VALUES (?, ?)"),
    removeDep: db.prepare("DELETE FROM dependencies WHERE item_id = ? AND depends_on_id = ?"),

    countChecklistTotal: db.prepare(
      "SELECT COUNT(*) as cnt FROM checklist_items WHERE item_id = ?"
    ),
    countChecklistDone: db.prepare(
      "SELECT COUNT(*) as cnt FROM checklist_items WHERE item_id = ? AND checked = 1"
    ),

    deleteItem: db.prepare("DELETE FROM items WHERE id = ?"),

    countItemsByStatus: db.prepare(
      "SELECT status, COUNT(*) as cnt FROM items GROUP BY status"
    ),
  };
}
