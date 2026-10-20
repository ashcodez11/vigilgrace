/**
 * Dev-only screenshot helper: drives the running web preview through the Chrome
 * DevTools Protocol and writes PNGs to docs/preview/.
 *
 * Usage:
 *   node scripts/capture-preview.mjs <emailA> <password> [emailB]
 *
 * Account A needs one verified and one unverified test contact; account B needs
 * no contacts (used for the honest "no verified contacts" SOS failure). The
 * backend must run in mock provider mode, so nothing reaches a real handset.
 *
 * Requires Chrome started with --remote-debugging-port=9223. Only placeholder
 * numbers (+9190000000xx) appear in the captures.
 */
import fs from 'node:fs';
import path from 'node:path';

import WebSocket from 'ws';

const PORT = process.env.CDP_PORT ?? '9223';
const BASE = process.env.PREVIEW_BASE ?? 'http://localhost:8081';
const OUT = path.resolve('docs/preview');
const [emailA, password, emailB] = process.argv.slice(2);
if (!emailA || !password) {
  throw new Error('usage: node scripts/capture-preview.mjs <emailA> <password> [emailB]');
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

async function goto(url, waitMs = 12000) {
  await send('Page.navigate', { url });
  await sleep(waitMs);
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('wrote', file);
}

async function clickText(text) {
  return evaluate(`(() => {
    const nodes = [...document.querySelectorAll('[role="button"], [role="tab"], button, [tabindex]')];
    const hit = nodes.find((n) => (n.innerText || '').trim().replace(/^([^\\w]+\\s)+/, '').startsWith(${JSON.stringify(text)}));
    if (!hit) return 'not-found';
    hit.click();
    return 'clicked';
  })()`);
}

async function clickExact(text) {
  return evaluate(`(() => {
    const nodes = [...document.querySelectorAll('[role="button"], button')];
    const hit = nodes.find((n) => (n.innerText || '').trim() === ${JSON.stringify(text)});
    if (!hit) return 'not-found';
    hit.click();
    return 'clicked';
  })()`);
}

async function scrollToText(text) {
  return evaluate(`(() => {
    const nodes = [...document.querySelectorAll('div, span')];
    const needle = ${JSON.stringify(text)};
    const hits = nodes.filter((n) => (n.innerText || '').includes(needle));
    const hit = hits[hits.length - 1];
    if (!hit) return 'not-found';
    hit.scrollIntoView({ block: 'center' });
    return 'scrolled';
  })()`);
}

async function typeInto(label, value) {
  return evaluate(`(() => {
    const inputs = [...document.querySelectorAll('input, textarea')];
    const needle = ${JSON.stringify(label.toLowerCase())};
    const el = inputs.find((i) => (i.getAttribute('aria-label') || '').toLowerCase().includes(needle) || (i.placeholder || '').toLowerCase().includes(needle));
    if (!el) return 'not-found';
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
}

const bodyText = () => evaluate('document.body.innerText');

async function expectContains(label, needle) {
  const text = await bodyText();
  const ok = text.includes(needle);
  console.log(`${label}: ${ok ? 'ok' : `MISSING (${needle})`}`);
  return ok;
}

async function login(email) {
  await goto(`${BASE}/login`);
  console.log('email:', await typeInto('email', email));
  console.log('password:', await typeInto('password', password));
  await sleep(700);
  console.log('submit:', await clickText('Sign in'));
  await sleep(7000);
}

async function logout() {
  console.log('settings:', await clickText('Settings'));
  await sleep(2000);
  console.log('sign out:', await clickText('Sign out'));
  await sleep(5000);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 420,
  height: 900,
  deviceScaleFactor: 2,
  mobile: true,
});

// Start from a clean app state so a previous session's theme/settings cannot
// leak into the captures.
await goto(`${BASE}/login`, 6000);
await evaluate('sessionStorage.clear(); localStorage.clear(); true');
await send('Page.reload');
await sleep(7000);

// 1. Account A: dashboard.
await login(emailA);
await shot('01-dashboard');
await expectContains('dashboard', 'Safety dashboard');

// 2. Countdown, cancellation, then a dispatched alert through the mock provider.
console.log('sos:', await clickText('SOS'));
await sleep(1500);
await shot('02-sos-countdown');
await expectContains('countdown', 'SEND NOW');
console.log('cancel:', await clickExact('CANCEL'));
await sleep(1500);
await shot('03-sos-cancelled');
await expectContains('cancelled', 'SOS CANCELLED');

console.log('dismiss:', await clickExact('OK'));
await sleep(1000);
console.log('sos again:', await clickText('SOS'));
await sleep(1200);
console.log('send now:', await clickExact('SEND NOW'));
await sleep(6000);
await shot('04-sos-simulated-success');
await expectContains('simulated success', 'SIMULATED');
console.log('dismiss delivered:', await clickText('Dismiss'));
await sleep(1200);

// 3. Contacts: verified + unverified, then the pending-code and verified states.
console.log('contacts tab:', await clickText('Contacts'));
await sleep(2500);
await scrollToText('Second Contact (unverified)');
await sleep(600);
await shot('05-contacts-states');
await expectContains('contacts', 'VERIFIED');
await expectContains('contacts unverified', 'UNVERIFIED');

console.log('scroll to button:', await scrollToText('Send verification code'));
console.log('send code:', await clickText('Send verification code'));
await sleep(2500);
console.log('scroll to code:', await scrollToText('Enter the 6-digit code'));
await sleep(600);
await shot('06-contact-verification-pending');
await expectContains('pending verification', 'Enter the 6-digit code');
const text = await bodyText();
const code = text.match(/verification code is:?\s*(\d{6})/i)?.[1];
if (!code) console.log('WARN: no dev code found in page text');
else {
  console.log('code field:', await typeInto('verification code', code));
  await sleep(500);
  console.log('verify:', await clickText('Verify'));
  await sleep(2500);
  console.log('scroll to verified:', await scrollToText('Second Contact'));
  await sleep(600);
  await shot('07-contact-verified');
  await expectContains('contact verified', 'Active — receives your SOS alerts');
}

// 4. History with the simulated alert and its digest.
console.log('history tab:', await clickText('History'));
await sleep(2500);
await shot('08-history');
await expectContains('history', 'Emergency history');
await expectContains('history simulated', 'SIMULATED');

// 5. Trigger status screens (foreground-only claims are stated on them).
console.log('safety tab:', await clickText('Safety'));
await sleep(2000);
console.log('motion:', await clickText('Motion'));
await sleep(2500);
await shot('09-motion-trigger');
await expectContains('motion', 'Motion trigger');
console.log('back:', await evaluate('history.back(); true'));
await sleep(2500);
console.log('voice:', await clickText('Voice'));
await sleep(2500);
await shot('10-voice-trigger');
await expectContains('voice', 'Voice distress');
console.log('back2:', await evaluate('history.back(); true'));
await sleep(2500);
// 6. Settings: SOS countdown, trigger toggles, backend override. The appearance
// controls are present but intentionally not exercised here.
console.log('settings tab:', await clickText('Settings'));
await sleep(2500);
await scrollToText('SOS behaviour');
await sleep(600);
await shot('11-settings');
await expectContains('settings', 'SOS behaviour');
await expectContains('settings triggers', 'Shake-to-SOS');

// 7. Account B: an SOS with no verified contacts must fail loudly and truthfully.
await logout();
await login(emailB);
await expectContains('account b dashboard', 'Safety dashboard');
console.log('sos b:', await clickText('SOS'));
await sleep(1200);
console.log('send now b:', await clickExact('SEND NOW'));
await sleep(7000);
await shot('12-sos-failed-no-contacts');
await expectContains('sos failure', 'No verified emergency contacts');

ws.close();
