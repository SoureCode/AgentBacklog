# Dependencies

Dependencies express "item A cannot start until item B is done". Cycle detection prevents circular dependencies.

## Add dependency

```
POST /api/items/:id/dependencies
```

The item at `:id` will depend on `depends_on_id`.

**Request body**
```json
{
  "version": 2,
  "depends_on_id": 5
}
```

| Field | Type | Required |
|---|---|---|
| `version` | integer | ✅ |
| `depends_on_id` | integer | ✅ |

**Response `201`** — the updated item (same shape as [Get item](./items.md#get-item)).

**Response `400`** — if adding the dependency would create a cycle.

---

## Remove dependency

```
DELETE /api/items/:id/dependencies/:did
```

Where `:did` is the `depends_on_id` to remove.

**Request body**
```json
{
  "version": 3
}
```

| Field | Type | Required |
|---|---|---|
| `version` | integer | ✅ |

**Response `200`** — the updated item.
