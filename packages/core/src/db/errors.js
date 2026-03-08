export class NotFoundError extends Error {
  constructor(id) {
    super(typeof id === "number" ? `BacklogItem ${id} not found` : String(id));
    this.name = "NotFoundError";
    this.id = id;
  }
}

export class VersionConflictError extends Error {
  constructor(id, expectedVersion, currentItem) {
    super(
      `CONFLICT: BacklogItem ${id} has been modified by another agent ` +
      `(your version: ${expectedVersion}, current version: ${currentItem.version}). ` +
      `Re-fetch the item with backlog_get(id: ${id}) to see the latest state, ` +
      `then retry your operation with the new version number.`
    );
    this.name = "VersionConflictError";
    this.id = id;
    this.expectedVersion = expectedVersion;
    this.currentItem = currentItem;
  }
}
