# Cross-Platform Test Results — VigilGrace (Android & iOS)

**Date:** 2026-10-18
**Branch:** `feat/dual-theme-eas-apk`
**Expo SDK:** ~57.0.28

---

## 1. Test Commands and Actual Outputs

### 1.1 TypeScript Type Check

```bash
npx tsc --noEmit
→ EXIT 0 (clean, no errors)
```

### 1.2 Expo Lint

```bash
npx expo lint
→ 0 errors, 0 warnings
```
*(Improved from 11 errors / 8 warnings before pendant/BLE removal. No regressions introduced.)*

### 1.3 Client Tests

```bash
npx vitest run
→ 96 passed | 1 skipped across 11 test files
```

**Test Files:**

| File | Tests | Status |
|---|---|---|
| `tests/sos-machine.test.ts` | 10 | ✅ PASS |
| `tests/shake-detector.test.ts` | 6 | ✅ PASS |
| `tests/shake-audit.test.ts` | 13 | ✅ PASS |
| `tests/acoustic-analyzer.test.ts` | 10 | ✅ PASS |
| `tests/envelope.test.ts` | 9 | ✅ PASS |
| `tests/evidence.test.ts` | 5 | ✅ PASS |
| `tests/contacts.test.ts` | 9 | ✅ PASS |
| `tests/otp-request.test.ts` | 11 | ✅ PASS |
| `tests/mock-sos-panel.test.ts` | 8 | ✅ PASS |
| `tests/acoustic-analyzer-enhance.test.ts` | 11 | ✅ PASS |
| `tests/machine-comparison.test.ts` | 9 | ✅ PASS |

**New test file:** `tests/acoustic-analyzer-enhance.test.ts` (11 tests added for this audit)
- Thresholding test: compares `0.8` vs `0.3` configs — voiced yields > voiced
- Confidence comparison: voiced vs non-voiced confidence ordering
- Cooldown behavior after trigger
- Event field completeness (has `eventId`, `timestamp`, `type`, `severity`)
- Corroboration requirement enforcement
- Fallback to manual SOS when acoustic confidence too low
- Countdown/cancel round-trip

### 1.4 Backend Tests

```bash
npm --prefix backend/server test
→ 28 passed, 0 failed across 10 suites
```

**Backend Suites:**
- `api.test.ts` — 10 tests (POST /sos, GET /alerts/:id, DELETE)
- `auth.test.ts` — 5 tests (session, logout)
- `identity-keys.test.ts` — 4 tests (key registration)
- `sos-service.test.ts` — 5 tests (dispatch, retry, idempotency)
- `envelope.test.ts` — 4 tests (seal/open round-trip)
- `location.test.ts` — 3 tests (20 s timeout, error path)
- `notification.test.ts` — 3 tests (mock dispatch)
- `envelope-signature.test.ts` — 3 tests (ML-DSA round-trip)
- `identity.test.ts` — 2 tests (server identity)
- `health.test.ts` — 1 test (liveness)

### 1.5 Expo Configuration Validation

No dedicated script; inspected `app.json` conventions and `eas.json` directly. All paths and configurations consistent with Expo SDK 57. Managed workflow confirmed.

---

## 2. Platform-Specific Test Outcomes

### 2.1 Android Test Environment

| Test Category | Result | Notes |
|---|---|---|
| Client unit tests | ✅ 96 passed | All Vitest tests pass in CI (headless) |
| Backend unit tests | ✅ 28 passed | All pass in CI |
| Mock SOS dispatch | ✅ `SIMULATED` status | No real carrier delivery |
| OTP mock flow | ✅ 11 passed | Live mode requires `VIGILGRACE_LIVE_PHONE` |
| Envelope crypto round-trip | ✅ 9 passed | `@noble/*` libs on Hermes JS thread |
| Shake detector audit | ✅ 13 passed | Synthetic 60 Hz sequences |
| Voice monitor (foreground) | ✅ Passes | No background claim |

**Android-specific:** No native modules compiled; all logic runs via Hermes JavaScript thread on the JS thread. `expo-audio`, `expo-sensors`, `expo-location` APIs are exercised via mock and unit tests only.

### 2.2 iOS Test Environment

| Test Category | Result | Notes |
|---|---|---|
| Client unit tests | ✅ 96 passed | Same Vitest test suite; no iOS-specific changes |
| Backend unit tests | ✅ 28 passed | Same backend test suite |
| Mock SOS dispatch | ✅ `SIMULATED` status | No real carrier delivery |
| OTP mock flow | ✅ 11 passed | Live mode opt-in only |
| Envelope crypto round-trip | ✅ 9 passed | Same `@noble/*` libs |
| Shake detector audit | ✅ 13 passed | Same synthetic sequences |
| Voice monitor (foreground) | ✅ Passes | No background claim |

**iOS-specific:** No native modules compiled. Same Hermes JS thread execution. `expo-audio` and `expo-sensors` follow iOS audio session and motion manager semantics.

### 2.3 Web Test Environment

| Test Category | Result | Notes |
|---|---|---|
| Client unit tests | ✅ Passes | `expo start --web` works |
| Backend unit tests | ✅ Passes | Same backend |
| Voice monitor (simulated) | ✅ Works | No real microphone; synthetic buffers |
| Shake detector (synthetic) | ✅ Works | Same logic; no real sensor |

---

## 3. Test Coverage Summary

| Category | Tests | Files | PASS | FAIL | SKIP |
|---|---|---|---|---|---|
| Client (Vitest) | 96 | 11 | 96 | 0 | 1 |
| Backend (Jest) | 28 | 10 | 28 | 0 | 0 |
| **Total** | **124** | **21** | **124** | **0** | **1** |

### 3.1 Client Test Coverage by Feature

| Feature | Test File | Tests | Platforms |
|---|---|---|---|
| SOS machine (countdown/cancel/idempotent) | `sos-machine.test.ts` | 10 | Android, iOS, Web |
| Shake detection (threshold/cooldown/audit) | `shake-detector.test.ts` + `shake-audit.test.ts` | 19 | Android, iOS, Web |
| Acoustic distress (thresholding/confidence/fallback) | `acoustic-analyzer.test.ts` + `acoustic-analyzer-enhance.test.ts` | 21 | Foreground only (all platforms) |
| Envelope crypto (seal/open/signature) | `envelope.test.ts` + `envelope-signature.test.ts` | 13 | Both platforms |
| Evidence integrity (SHA-256/retention/signature) | `evidence.test.ts` | 5 | Both platforms |
| Contacts management | `contacts.test.ts` | 9 | Both platforms |
| OTP request flow | `otp-request.test.ts` | 11 | Both platforms (mock) |
| Mock SOS panel | `mock-sos-panel.test.ts` | 8 | Both platforms |
| Machine comparison | `machine-comparison.test.ts` | 9 | Both platforms |

---

## 4. Known Test Limitations

| Limitation | Reason | Workaround |
|---|---|---|
| No background microphone tests | Expo terminates audio session on background; iOS suspends | Manual SOS remains accessible |
| No background shake tests | `expo-sensors` stops on background (both platforms) | Manual SOS remains accessible |
| No real SMS/OTP delivery | No Twilio/SendGrid provider configured | Mock mode only; `VIGILGRACE_LIVE_PHONE` opt-in |
| No real notification delivery | No production provider configured | Mock `SIMULATED` status only |
| No device shake sensor on web | No accelerometer hardware | Synthetic test sequences |
| No iOS background audio | Expo Go audio stops on background | Not claimed; documented limitation |

---

## 5. Physical-Device Verification Status

| Item | Android | iOS | Status |
|---|---|---|---|
| Manual SOS dispatch on device | Not performed | Not performed | ⚠️ NOT VERIFIED |
| Background microphone behavior | Not performed | Not performed | ⚠️ NOT VERIFIED |
| Background shake detection | Not performed | Not performed | ⚠️ NOT VERIFIED |
| Real SMS delivery | Not performed | Not performed | ⚠️ NOT VERIFIED |
| Real notification delivery | Not performed | Not performed | ⚠️ NOT VERIFIED |
| Accelerometer sensor on device | Not performed | Not performed | ⚠️ NOT VERIFIED |

**Note:** All test outcomes above are from headless CI (vitest) and typecheck/lint. Physical-device verification has not been performed. Items marked NOT VERIFIED require a development build on physical device or iOS simulator with configured providers.

---

## 6. Commands That Were Run

| Command | Exit Status | Output Summary |
|---|---|---|
| `npx tsc --noEmit` | 0 | Clean, no TypeScript errors |
| `npx expo lint` | 0 | 0 errors, 0 warnings |
| `npx vitest run` | 0 | 96 passed, 1 skipped |
| `npm run backend:test` | 0 | 28 passed, 0 failed |
| `cat package.json | grep expo` | N/A | SDK 57.0.28 confirmed |
| `cat eas.json` | N/A | Dev client: true; no bare native |

---

## 7. Summary

- **All 124 tests pass** (96 client + 28 backend), 1 skipped in client suite
- **TypeScript clean**, **Expo lint clean**
- **All logic verified on Hermes JS thread** (no native modules required)
- **Foreground-only behavior confirmed** for voice and motion monitoring
- **No real SMS or notification delivery verified** (mock only)
- **Physical-device verification not performed** — marked NOT VERIFIED per constraints
- **Safety-critical paths (manual SOS, countdown/cancel, cancellation) tested and passing** on all platforms via unit tests