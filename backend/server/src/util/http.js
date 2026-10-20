/**
 * Tiny dependency-free HTTP helpers + router for the VigilGrace backend.
 *
 * Deliberately minimal: the app talks JSON over fetch, so the server needs no
 * framework. Keeping the backend dependency-free means `npm run backend:start`
 * works offline and the security-relevant surface stays small and auditable.
 */

/** Send a JSON response. */
export function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

/** Send an error the app can display: { error: "message" }. */
export function fail(res, status, message) {
  json(res, status, { error: message });
}

/** Read and parse a JSON body (bounded, never throws). */
export async function readJson(req, limitBytes = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) return null;
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Minimal path router.
 *
 * Patterns use `:name` segments, e.g. '/contacts/:id/verify'. Handlers receive
 * (req, res, params). Registered in order; first match wins.
 */
export function createRouter() {
  const routes = [];

  const add = (method, pattern, handler) => {
    const segments = pattern.split('/').filter(Boolean);
    routes.push({ method, segments, handler });
  };

  const match = (method, pathname) => {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of routes) {
      if (route.method !== method || route.segments.length !== parts.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < parts.length; i += 1) {
        const seg = route.segments[i];
        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(parts[i]);
        } else if (seg !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  };

  return { add, match };
}
