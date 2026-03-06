# Events (SSE)

Live updates via Server-Sent Events. The server pushes a new `update` event whenever items change, and immediately on connection.

## Authenticated (MCP / agent use)

```
GET /api/events
Authorization: Bearer sk-proj-<key>
```

## Per-project (kanban UI use)

```
GET /api/projects/:slug/events
```

No auth required — intended for the kanban UI served on localhost.

---

## Event format

```
event: update
data: [/* full item list for the project */]
```

The `data` payload is the same array returned by `GET /api/items`. The client should replace its entire local state on each event.

---

## Example (curl)

```bash
curl -N http://localhost:4000/api/events \
  -H "Authorization: Bearer sk-proj-abc123..."
```
