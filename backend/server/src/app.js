/**
 * App assembly: routes, CORS, health and the top-level error boundary.
 *
 * `buildApp` is exported separately from the listener so tests can drive the
 * real request pipeline without opening a socket.
 */

import { resolveMode } from './delivery/providers.js';
import { registerAlertRoutes } from './routes/alerts.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerContactRoutes } from './routes/contacts.js';
import { createRouter, fail, json } from './util/http.js';

export function buildApp({ store, env = process.env, now } = {}) {
  const ctx = { store, env, now };
  const router = createRouter();

  router.add('GET', '/health', async (req, res) => {
    // `smsProvider` reports configuration state only — never a credential.
    return json(res, 200, {
      ok: true,
      name: 'VigilGrace Backend',
      version: '1.0.0',
      smsProvider: resolveMode(env),
    });
  });

  registerAuthRoutes(router, ctx);
  registerContactRoutes(router, ctx);
  registerAlertRoutes(router, ctx);

  return async function handle(req, res) {
    // The app is native; Expo web dev also talks to this server, so answer
    // preflights. Tokens travel in the Authorization header, never cookies.
    res.setHeader('Access-Control-Allow-Origin', env.VIGILGRACE_ALLOWED_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    let pathname = '/';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname.replace(/\/+$/, '') || '/';
    } catch {
      return fail(res, 400, 'Malformed request URL.');
    }

    const route = router.match(req.method, pathname);
    if (!route) return fail(res, 404, `No such endpoint: ${req.method} ${pathname}`);

    try {
      req.params = route.params;
      return await route.handler(req, res, route.params);
    } catch (err) {
      // Log the failure without request bodies (they can hold codes/passwords).
      console.error(`[error] ${req.method} ${pathname}: ${err && err.message}`);
      if (res.headersSent) return undefined;
      return fail(res, 500, 'The server hit an unexpected error.');
    }
  };
}
