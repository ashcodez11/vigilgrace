/**
 * VigilGrace backend entry point.
 *
 *   npm run backend:install   (no dependencies; creates the lockfile)
 *   npm run backend:start     (defaults to http://0.0.0.0:4001)
 *   npm run backend:test
 *
 * Config (env only — no secrets in source):
 *   PORT, VIGILGRACE_HOST, VIGILGRACE_DATA_FILE
 *   VIGILGRACE_SMS_PROVIDER=mock|twilio|webhook, VIGILGRACE_ALLOW_MOCK=1,
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM (or ..._MESSAGING_SERVICE_SID),
 *   VIGILGRACE_SMS_WEBHOOK_URL / VIGILGRACE_SMS_WEBHOOK_TOKEN
 */

import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from './app.js';
import { resolveMode } from './delivery/providers.js';
import { createStore } from './util/store.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataFile =
  process.env.VIGILGRACE_DATA_FILE || path.join(packageRoot, 'data', 'db.json');
/**
 * Resolve the listening port.
 *
 * `PORT=0` (or a non-numeric value) makes the OS pick an ephemeral port. That
 * is useful for tests but hostile for a dev server the phone is supposed to
 * find: the app has a fixed URL and the server binds somewhere else. Treat
 * anything outside 1..65535 as "unset" and say so, instead of quietly binding
 * a port nobody can reach.
 */
function resolvePort(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { port: 4001, ignored: null };
  const parsed = Number(text);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
    return { port: parsed, ignored: null };
  }
  return { port: 4001, ignored: text };
}

const { port, ignored } = resolvePort(process.env.PORT);
const host = process.env.VIGILGRACE_HOST || '0.0.0.0';

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address);
}

const store = createStore({ file: dataFile });
const app = buildApp({ store });

const server = createServer(app);

server.listen(port, host, () => {
  const mode = resolveMode(process.env);
  const bound = server.address();
  const boundPort = typeof bound === 'object' && bound ? bound.port : port;
  console.log(`VigilGrace backend listening on http://${host}:${boundPort}`);
  console.log(`Local health check: http://127.0.0.1:${boundPort}/health`);
  for (const address of lanAddresses()) {
    console.log(`LAN (phone) base URL: http://${address}:${boundPort}`);
  }
  if (ignored !== null) {
    console.log(
      `Ignoring PORT=${JSON.stringify(ignored)} (must be 1-65535); using ${boundPort} ` +
        'because the app expects a fixed port.',
    );
  }
  console.log(`Data file: ${dataFile}`);
  if (mode === 'unknown') {
    console.log(
      'SMS provider: NOT CONFIGURED — verification requests are refused with HTTP 503 ' +
        'instead of pretending a code was sent.',
    );
  } else if (mode === 'mock') {
    console.log(
      'SMS provider: mock (DEV ONLY, VIGILGRACE_ALLOW_MOCK=1) — codes are returned to ' +
        'the requesting app and no SMS is sent.',
    );
  } else {
    console.log(`SMS provider: ${mode}`);
  }
});
