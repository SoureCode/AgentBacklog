# Items

## List items

```
GET /api/items
GET /api/items?status=open
```

Optional `status` filter: `open`, `in_progress`, `done`.

**Response `200`**
```json
[
  {
    "id": 1,
    "title": "Add dark mode",
    "description": "Support prefers-color-scheme",
    "status": "open",
    "version": 1,
    "created_at": "2026-03-01T10:00:00Z",
    "updated_at": "2026-03-01T10:00:00Z"
  }
]
```

---

## Get item

```
GET /api/items/:id
```

Returns the full item including checklist, comments, and dependencies.

**Response `200`**
```json
{
  "id": 1,
  "title": "Add dark mode",
  "description": "Support prefers-color-scheme",
  "status": "open",
  "version": 2,
  "created_at": "2026-03-01T10:00:00Z",
  "updated_at": "2026-03-02T09:00:00Z",
  "checklist": [
    { "id": 1, "label": "Design tokens", "checked": true, "parent_id": null, "children": [] },
    { "id": 2, "label": "CSS variables", "checked": false, "parent_id": null, "children": [] }
  ],
  "comments": [
    { "id": 1, "body": "Blocked on design system update", "author": "agent", "created_at": "2026-03-02T09:00:00Z" }
  ],
  "dependencies": [3, 5]
}
```

---

## Create item

```
POST /api/items
```

**Request body**
```json
{
  "title": "Add dark mode",
  "description": "Support prefers-color-scheme",
  "status": "open"
}
```

| Field | Type | Required |
|---|---|---|
| `title` | string (1–255 chars) | ✅ |
| `description` | string | — |
| `status` | `open` \| `in_progress` \| `done` | — (default: `open`) |

**Response `201`** — the created item (same shape as Get item).

---

## Update item

```
PATCH /api/items/:id
```

Requires the item's current `version` for optimistic locking. If the version doesn't match a `409` is returned — re-fetch with Get item and retry.

**Request body**
```json
{
  "version": 2,
  "status": "in_progress"
}
```

| Field | Type | Required |
|---|---|---|
| `version` | integer | ✅ |
| `title` | string (1–255 chars) | — |
| `description` | string | — |
| `status` | `open` \| `in_progress` \| `done` | — |

**Response `200`** — the updated item (same shape as Get item).

**Response `409`** — version conflict
```json
{
  "error": "Version conflict: expected version 2 but current is 3",
  "current": { /* full current item */ }
}
```
