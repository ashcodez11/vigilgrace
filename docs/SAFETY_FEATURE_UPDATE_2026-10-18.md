# Safety feature update — 2026-10-18

Scope: SOS reliability, emergency contacts, phone triggers, evidence/security,
navigation/accessibility. The Bluetooth pendant was removed on 2026-10-18 and is
no longer part of the app (see §4). **No theme work** (palettes, theme styling
and the appearance switcher are untouched; the only colour-adjacent change is
removing duplicate navigator headers).

## 1. SOS reliability

| Defect | Fix |
| --- | --- |
| A hung HTTP request left the SOS in "Sending…" forever — no failure, no retry | `apiFetch` now has a hard per-request ceiling (`timeoutMs`, default 15 s); alert submission uses 20 s and maps a timeout to a retryable transport failure |
| "Retry (same alert ID)" after a recorded failure replayed the stored failure forever (the server's idempotency returned the old verdict) | A recorded **failed** alert is now re-dispatched to contacts without a successful result; delivered alerts stay immutable. Concurrent retries of one alert are serialised |
| Shake/voice/pendant firing during an active SOS restarted the evidence recorder | `useSosController.trigger` ignores triggers while the machine is counting down/sending/retrying |
| Evidence could be dropped for a failed-but-recorded alert, or when `stop()` ran before React committed `recording` | Evidence attaches to any recorded alert; the recorder tracks state in a ref, not render state |
| Evidence MIME type hardcoded `audio/m4a` | Derived from the recorded file extension (`audio/mp4`, `audio/3gpp`, …) |

Failure copy now distinguishes "backend recorded the alert, delivery failed"
(retry re-attempts only unreached contacts) from "nothing was recorded" (retry
cannot duplicate a message).

## 2. Emergency contacts

- The list refreshes when the tab gains focus, so a verification or edit made
  elsewhere cannot leave stale state.
- Cards show **verified / code sent / unverified** plus "Active — receives your
  SOS alerts" or the expired-code hint.
- Removal requires an explicit confirmation step (cross-platform, no native
  `Alert` dependency) and clears any open verification form.
- The old banner claiming every account was "seeded with two initial contacts"
  was false for accounts without local seeds; it now explains that only verified
  contacts are alerted and that mock-mode codes are shown in-app.
- Only server-side `verified` contacts are ever messaged (already enforced, now
  covered by tests).

## 3. Phone safety triggers

- `use-shake-monitor` and `use-voice-monitor` no longer write refs during render
  or call `setState` synchronously inside an effect; the audio `onBuffer`
  callback is stable (recreating it restarted stream options on every render).
- Dashboard countdown reads `Date.now()` only inside a timer, not during render.
- Motion screen cleanup resets the detector through a captured reference.
- Voice detection remains a foreground acoustic prototype with corroboration
  required by default; no background or lock-screen claim is made.

## 4. Bluetooth pendant — removed (2026-10-18)

The pendant/BLE feature was withdrawn at the owner's request and is now gone, not
hidden: `src/core/pendant/`, `src/app/(app)/pendant.tsx`,
`src/state/pendant-store.ts`, `src/services/ble-pendant.ts`,
`tests/double-press.test.ts`, the `pendant` trigger source, the
`pendantDoublePressWindowMs` setting, the stack route, the dashboard, settings and
profile entry points, the `react-native-ble-plx` dependency and config plugin, the
`BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` Android permissions and
`NSBluetoothAlwaysUsageDescription`. The app no longer requests Bluetooth access,
ships no pairing UI and makes no wearable safety claim.

## 5. Evidence and security

- Evidence sync covers recorded-but-undelivered alerts; digests still describe
  the exact bytes handed to `buildEvidenceRecord`.
- Security screen reads the cached server keys for the **active backend URL**
  instead of whichever server was cached last.
- Raw audio never leaves the device; alert payloads carry metadata only, and the
  backend rejects raw content (pinned by tests).
- The owner's handset number that was hardcoded in five test files and quoted in
  the OTP diagnosis document is gone: fixtures now use `+9190000000xx`
  placeholders, and the opt-in live test reads `VIGILGRACE_LIVE_PHONE` instead.
- SecureStore chunking and session handling unchanged; web preview continues to
  use sessionStorage with an explicit "preview only" warning.

## 6. Navigation and accessibility

- Tab screens had two headers (navigator + in-screen `<Screen>`); the navigator
  header is hidden for tabs, and stack sub-screens keep only the back affordance.
- Countdown cancel/send-now, retry, removal confirmation and verification entry
  remain reachable at 420 × 900 CSS px.
- SOS, CANCEL and confirmation dialogs keep explicit labels; tab bar exposes
  Safety / Contacts / History / Settings.

## Checks run (after pendant removal)

| Command | Exit | Result |
| --- | --- | --- |
| `npx tsc --noEmit` | 0 | clean |
| `npx expo lint` | 0 | 0 errors, 0 warnings (was 11 errors / 8 warnings) |
| `npx vitest run` | 0 | 9 files, 72 passed, 1 skipped (81 before the 9 pendant tests were deleted) |
| `npm run backend:test` | 0 | 28 passed, 0 failed |

Web preview screenshots in `docs/preview/` were captured through the Chrome
DevTools Protocol against the running mock-provider backend (port 4001) with
placeholder contacts (`+9190000000xx`). The capture script itself asserts the
screen text and fails loudly when an expected state is missing.

## 7. Compliance audit (code, not report text)

| Claim | Status | Evidence |
| --- | --- | --- |
| SOS countdown / cancel / send-now | present, tested | `src/core/sos/sos-machine.ts`, `tests/sos-machine.test.ts`, screens `02`–`03` |
| Retry of a recorded failure, idempotent `alertId` | present, tested | `routes/alerts.js` (failed branch, `inFlightRetries`), `tests/alerts.test.js` |
| Duplicate-trigger prevention while active | present | `use-sos-controller.ts` guard, `sos-machine` ignores triggers |
| Truthful delivery states (mock labelled) | present, verified in UI | `SosPanel` renders `SIMULATED` wording, screenshot `04` |
| Hard timeout on every request (SOS 20 s) | present | `services/api.ts`, `services/backend.ts:110` |
| Location failure never blocks the alert | present | `services/location.ts` returns `null` on every failure path |
| Delivered alert immutable, concurrent retries serialised | present, tested | `routes/alerts.js` retry branch; `tests/alerts.test.js` |
| Only verified contacts are messaged | present, tested | `deliverToVerifiedContacts`, backend tests |
| Contacts add/edit/delete + validation + confirmation | present | `contacts.tsx`, `contacts-store.ts`, `tests/contacts.test.ts` |
| Contact verification states + focus refresh + errors | present, verified in UI | `useFocusEffect(refreshContacts)`, screenshots `05`–`07` |
| Shake detection: threshold, spikes, debounce, cooldown | present, tested | `core/motion/shake-detector.ts`, `tests/shake-detector.test.ts` |
| Shake/voice lifecycle + unsupported-platform handling | present | `use-shake-monitor.ts`, `use-voice-monitor.ts`, `permissions.ts` |
| Voice analysis + corroboration (prototype, labelled) | present, tested | `core/voice/acoustic-analyzer.ts`, `tests/acoustic-analyzer.test.ts` |
| Evidence digest, MIME detection, integrity verification | present, tested | `core/evidence/integrity.ts`, `tests/evidence.test.ts` |
| Undelivered-alert evidence sync | present, best-effort by design | `use-sos-controller.ts` attaches for any recorded alert |
| Secure storage + session | present (web falls back to sessionStorage, labelled preview-only) | `services/secure-store.ts` |
| Server-key cache separated per backend URL | present | `services/identity-keys.ts`, `resolveServerCrypto` |
| Audio never leaves the device | present, pinned by tests | alert payload carries metadata only; backend rejects raw content |
| Auth, four reachable tabs, accessibility labels | present, web-verified | tab layout + signed-in navigation check; device a11y untested |
| Backend routes + mock provider | present, 28 tests | `backend/server/test/*.js` |
| Bluetooth pendant | **removed** | see §4 |

## Still requires real-world verification

- Android/iOS device run: SOS dispatch, shake sensor, voice capture, permission
  prompts, tab bar and safe areas.
- A production SMS provider (Twilio or a webhook gateway) — mock mode proves the
  contract, not carrier delivery.
- No hardware path remains: the pendant was removed, so there is nothing
  Bluetooth-related left to test on a device.
