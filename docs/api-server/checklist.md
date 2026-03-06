# Checklist

## Add checklist item

```
POST /api/items/:id/checklist
```

**Request body**
```json
{
  "version": 2,
  "label": "Write unit tests",
  "parent_id": null
}
```

| Field | Type | Required |
|---|---|---|
| `version` | integer | ✅ |
| `label` | string (min 1 char) | ✅ |
| `parent_id` | integer | — (omit for top-level) |

**Response `201`** — the updated item (same shape as [Get item](./items.md#get-item)).

---

## Update checklist item

```
PATCH /api/items/:id/checklist/:cid
```

**Request body**
```json
{
  "version": 3,
  "checked": true
}
```

| Field | Type | Required |
|---|---|---|
| `version` | integer | ✅ |
| `label` | string | — |
| `checked` | boolean | — |

**Response `200`** — the updated item.

---

## Delete checklist item

```
DELETE /api/items/:id/checklist/:cid
```

Cascades to child checklist items.

**Request body**
```json
{
  "version": 4
}
```

| Field | Type | Required |
|---|---|---|
| `version` | integer | ✅ |

**Response `200`** — the updated item.
