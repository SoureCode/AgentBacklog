# Search

```
GET /api/search?q=<query>
GET /api/search?q=<query>&status=open
```

Searches titles and descriptions. Results are ranked by relevance (title matches score higher). All tokens must appear somewhere in the item (AND logic).

| Parameter | Required | Description |
|---|---|---|
| `q` | ✅ | Search query |
| `status` | — | Filter by `open`, `in_progress`, or `done` |

**Response `200`**
```json
[
  {
    "id": 4,
    "title": "Dark mode toggle",
    "description": "Add a toggle button for dark mode",
    "status": "open",
    "version": 1,
    "created_at": "2026-03-01T10:00:00Z",
    "updated_at": "2026-03-01T10:00:00Z"
  }
]
```

**Response `400`** — missing `q`
```json
{ "error": "q parameter required" }
```
