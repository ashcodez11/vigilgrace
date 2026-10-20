/**
 * Dev-only capture for the voice-monitoring status screen — used by the
 * pretrained-AI research report.
 *
 * Shows the screen exactly as it behaves on the web preview: the prototype
 * warning, the real preset thresholds, the inactive keyword list, and an empty
 * detection log. No detection is simulated and no candidate event is invented —
 * web capture cannot exercise the microphone, so the log must stay empty.
 *
 * Usage:
 *   node scripts/capture-voice-status.mjs <email> <password>
 *
 * Requires Chrome running with --remote-debugging-port=9223 and the local mock
 * backend (npm run backend:start) plus the dev server on :8081.
 */
import fs from 'node:fs';
import path from 'node:path';

import WebSocket from 'ws';

const PORT = process.env.CDP_PORT ?? '9223';
const BASE = process.env.PREVIEW_BASE ?? 'http://localhost:8081';
const OUT = path.resolve('docs/preview');
const [email, password] = process.argv.slice(2);
if (!email || !password) {
  throw new Error('usage: node scripts/capture-voice-status.mjs <email> <password>');
}
fs.mkdirSync(OUT, { recursive: true });

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target; is Chrome running with --remote-debugging-port?');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? 'evaluate failed');
  }
  return res.result?.value;
}

async function clickText(text) {
  return evaluate(`(() => {
    const nodes = [...document.querySelectorAll('[role="button"], button, [tabindex]')];
    const hit = nodes.find((n) => (n.innerText || '').trim().startsWith(${JSON.stringify(text)}));
    if (!hit) return 'not-found';
    hit.click();
    return 'clicked';
  })()`);
}

async function typeInto(label, value) {
  return evaluate(`(() => {
    const inputs = [...document.querySelectorAll('input, textarea')];
    const needle = ${JSON.stringify(label.toLowerCase())};
    const el = inputs.find((i) => (i.getAttribute('aria-label') || '').toLowerCase().includes(needle) || (i.placeholder || '').toLowerCase().includes(needle));
    if (!el) return 'not-found';
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log('wrote', path.join(OUT, `${name}.png`));
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 420,
  height: 900,
  deviceScaleFactor: 2,
  mobile: true,
});

await send('Page.navigate', { url: `${BASE}/login` });
await sleep(6000);
await evaluate('sessionStorage.clear(); localStorage.clear(); true');
await send('Page.reload');
await sleep(7000);

console.log('email:', await typeInto('email', email));
console.log('password:', await typeInto('password', password));
await sleep(500);
console.log('submit:', await clickText('Sign in'));
await sleep(7000);

await send('Page.navigate', { url: `${BASE}/voice` });
await sleep(6000);

// innerText reflects CSS text-transform, so compare case-insensitively.
const text = await evaluate('document.body.innerText');
const lower = text.toLowerCase();
const checks = {
  title: text.includes('Voice distress'),
  prototypeBanner: lower.includes('prototype') && lower.includes('not a confirmed detector'),
  noKeywordMatching: lower.includes('no keyword matching and no classification model'),
  keywordInactive: lower.includes('keyword list (not active yet)'),
  emptyLog: text.includes('No candidate events yet.'),
};
console.log('checks:', JSON.stringify(checks));
if (Object.values(checks).some((ok) => !ok)) {
  ws.close();
  throw new Error(`voice screen does not show the expected honest status: ${JSON.stringify(checks)}`);
}

await shot('13-voice-monitoring-status');
ws.close();
