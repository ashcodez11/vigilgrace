# VigilGrace — Women Safety Communication System

Expo (SDK 57) / React Native app with a small Node.js backend. The app raises a
cancellable SOS, seals the alert with post-quantum cryptography, has the backend
message **verified** emergency contacts, and records per-contact delivery
results the UI reports honestly.

## What is implemented

| Area | Status |
| --- | --- |
| Manual SOS with countdown / cancel / send-now, retry with backoff | Implemented, unit + e2e tested |
| Sealed alert envelope (ML-KEM-768 → HKDF → AES-256-GCM, ML-DSA-65 signature) | Implemented, tested |
| Backend alert intake, signature/key/owner checks, idempotent `alertId` | Implemented, backend tested |
| Retry of a **recorded** failed alert (re-attempts only unreached contacts) | Implemented, backend tested |
| Emergency contacts CRUD + OTP verification; only verified contacts are alerted | Implemented, backend tested |
| SMS providers: `mock` (dev only), `twilio`, `webhook` | Implemented; **mock only** exercised here |
| Shake-to-SOS (foreground only, cooldown + debounce) | Implemented, detector tested; device sensor untested this round |
| Voice-distress acoustic prototype (foreground only, corroboration required by default) | Prototype, analyzer tested |
| Evidence metadata (SHA-256 digests, audio stays on device) | Implemented, tested |
| Dual themes, tab navigation, history, security status | Implemented |

### Explicitly not claimed

- No background, lock-screen or power-button activation. Accelerometer and
  microphone monitoring stop when the app is backgrounded.
- No wearable or Bluetooth trigger. The earlier BLE pendant experiment was
  removed on 2026-10-18; there is no pairing UI, BLE permission or pendant
  route in the app.
- No end-to-end encryption against the backend: the server must decrypt an
  alert to send SMS, so it is inside the trust boundary.
- Hashes prove integrity, not authorship; authenticity comes from the ML-DSA
  signature on the sealed envelope.
- Mock delivery sends nothing. A "SIMULATED" result is not evidence a message
  reached a person.

## Setup

```bash
npm install
npm --prefix backend/server install
```

Backend (mock SMS, dev only):

```bash
VIGILGRACE_SMS_PROVIDER=mock VIGILGRACE_ALLOW_MOCK=1 PORT=4001 npm run backend:start
```

App:

```bash
npm run web          # preview in a browser
npx expo run:android # development build for device testing
```

The app talks to the backend on port 4001. How that address is chosen:

| Runtime | Loopback config (`localhost:4001`) becomes |
|---|---|
| Android emulator | `http://10.0.2.2:4001` (the emulator's host alias) |
| Physical Android/iOS on a development build | the LAN host the Expo dev server reports, e.g. `http://192.168.1.2:4001` |
| iOS simulator / web | `http://localhost:4001` unchanged |

A physical phone cannot reach the computer through `localhost` or `10.0.2.2`.
Start Expo on the LAN (the default; not `--localhost` or `--tunnel`) and the
address is derived automatically. To pin it explicitly, set
`EXPO_PUBLIC_API_URL` / `extra.apiBaseUrl` / `config/local.config.json`, or use
Settings → Backend (a "Test connection" button reports what actually answered).

Debug Android builds allow cleartext HTTP (`android/app/src/debug`); a release
or EAS preview APK does not, so point that build at an HTTPS backend.

Never commit `config/local.config.json`, `backend/server/.env`,
`backend/server/data/`, signing keys, or real contact numbers.

## Verification

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # expo lint
npm test             # client unit + e2e (spawns a real backend on loopback)
npm run backend:test # backend node --test
```

`tests/sos-alert-e2e.test.ts` drives the real HTTP client, envelope sealing and
`dispatchSos` against a real backend process in mock provider mode. It never
sends a real message.

## Screenshots

`docs/preview/` contains captures of the SOS countdown, cancellation, simulated
success, honest failure, contact verified/unverified/pending states, history,
trigger screens and settings. All contacts there are placeholders
(`+9190000000xx`).

## Deeper docs

- `docs/AGENT_HANDOFF.md` — architecture and prior design notes
- `docs/OTP_DELIVERY_DIAGNOSIS_2026-10-16.md` — verification-code delivery fix
- `docs/SAFETY_FEATURE_UPDATE_2026-10-18.md` — safety feature audit and fixes
