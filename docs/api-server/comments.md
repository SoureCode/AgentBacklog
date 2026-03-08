# Comments

Comments are append-only — there is no update or delete.

## Add comment

```
POST /api/items/:id/comments
```

**Request body**
```json
{
  "body": "Blocked on design system update."
}
```

| Field | Type | Required |
|---|---|---|
| `body` | string (min 1 char) | ✅ |

**Response `201`** — the updated item (same shape as [Get item](./items.md#get-item)), with the new comment appended to `comments`.
