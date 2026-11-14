---
id: add-api-endpoint
title: How to add an API endpoint
type: howto
tags: [howto, api, express, route, csrf, validation, audit-log]
sources: [server.js, routes/events.js, routes/admin.js, routes/user.js, middleware/auth.js, middleware/validators.js, test/devServer.test.js]
depends_on: [server, middleware, conventions]
see_also: [api-index, testing, security]
---
# How to add an API endpoint

> TL;DR: Put the handler into the router that matches the audience (`routes/events.js` events for logged-in members, `routes/user.js` own account, `routes/admin.js` admin — auto-guarded), declare static paths before `/:id`, use the `firebaseAdmin.js` API, answer errors as `{ error: '<German text>' }`, write an audit log for admin mutations, call it from the SPA with the CSRF header, add a test in `test/devServer.test.js`, then update the wiki (`api-index` + router node) and run `npm run wiki`.

## Steps

1. **Pick the router**

   | Audience | File | Guard |
   |---|---|---|
   | anyone | `server.js` (next to `/api/server-info`) | none — keep it to non-event data |
   | logged-in member | `routes/events.js` | inherited from `router.use(requireAuth)`; `/:id` routes also get the draft/archived 404 from `router.param('id')`. A router mounted on the same path before it (`routes/eventAsk.js`) inherits **neither**: it adds `requireAuth` itself and its service checks the event |
   | own account | `routes/user.js` | add `requireAuth` |
   | admin | `routes/admin.js` | inherited from `router.use(requireAuth, requireAdmin)` |
   | new resource | new `routes/<name>.js` + `app.use('/api/<name>', require('./routes/<name>'))` in `server.js` next to the others (before the SPA fallback) |

2. **Write the handler** (pattern used everywhere):

   ```js
   /**
    * POST /api/events/:id/example — what it does
    */
   router.post('/:id/example', requireAuth, async (req, res) => {
       try {
           const snap = await getDoc(doc(db, 'events', req.params.id));
           if (!snap.exists()) return res.status(404).json({ error: 'Event nicht gefunden' });
           // ... logic, data access only via firebaseAdmin.js
           res.json({ success: true });
       } catch (err) {
           console.error('Example error:', err);
           res.status(500).json({ error: 'Fehler beim ...' });
       }
   });
   ```

3. **Validate input** in a middleware in `middleware/validators.js` if the body is non-trivial (German messages, 400).
4. **Admin mutation?** `await addAuditLog('<ACTION>', req.session.user.id, '<details>', targetId)` and document the action in [data-model](../concepts/data-model.md).
5. **Route order:** static segments (`/form-options`, `/series/:x`) above `/:id`.
6. **Do not leak secrets:** return event documents through `toPublicEvent(id, data)` from `utils/eventUtils.js`; it drops `checkinCode` and every other field in `PRIVATE_EVENT_FIELDS`.
7. **Frontend call** (the module of the area under `public/js/`, see [frontend-app](../modules/frontend-app.md); CSRF token from `state` in `core/state.js`): `fetch('/api/...', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken }, body: JSON.stringify(payload) })`, then `showToast(...)`. CSRF is enforced globally for mutating `/api/*`.
8. **Test** in `test/devServer.test.js`: `const admin = await loginAs('admin'); const res = await admin.send('POST', '/api/...', body);`.
9. **Wiki:** add the row to [api-index](../reference/api-index.md) and the router node, run `npm run wiki`.

## Pitfalls

- Express 5 path syntax: no bare `*`, optional params use braces (`/:id{/:sub}`).
- `req.body` is `{}` without a body (shim in `server.js`), `req.query` is read-only.
- Rate limit (200 / 15 min per IP on `/api/`) applies to new endpoints too.
