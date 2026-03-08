# Projects

Admin endpoint for the kanban UI. No authentication required — intended for localhost access only.

## List projects

```
GET /api/projects
```

**Response `200`**
```json
[
  {
    "slug": "my-project",
    "open": 4,
    "in_progress": 1,
    "done": 12,
    "total": 17
  },
  {
    "slug": "other-project",
    "open": 0,
    "in_progress": 0,
    "done": 3,
    "total": 3
  }
]
```

If a project's database cannot be read, `"error": true` is included instead of counts.

---

## List items for a project

```
GET /api/projects/:slug/items
```

Returns the same array as `GET /api/items` but scoped to the project identified by `:slug` rather than by API key.
