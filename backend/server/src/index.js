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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from './app.js';
import { resolveMode } from './delivery/providers.js';
import { createStore } from './util/store.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataFile =
  process.env.VIGILGRACE_DATA_FILE || path.join(packageRoot, 'data', 'db.json');
const port = Number(process.env.PORT || 4001);
const host = process.env.VIGILGRACE_HOST || '0.0.0.0';

const store = createStore({ file: dataFile });
const app = buildApp({ store });

createServer(app).listen(port, host, () => {
  const mode = resolveMode(process.env);
  console.log(`VigilGrace backend listening on http://${host}:${port}`);
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
