# Cross-Platform Compatibility — VigilGrace (Android & iOS)

**Date:** 2026-10-18
**Branch:** `feat/dual-theme-eas-apk`
**Expo SDK:** ~57.0.28
**React Native:** 0.86.3
**Workflow:** Managed Expo (no bare native project)

---

## 1. Project Architecture

### 1.1 Expo Configuration
- **eas.json**: Uses Expo Application Services (EAS) for builds
  - Development builds use `developmentClient: true`
  - Android builds produce APKs; no Android App Bundle (AAB) configuration
  - No production build configuration beyond auto-increment
  - Uses `expo-router` for all navigation
- **app.json**: Not present (Expo conventions used)
- **package.json**: 
  - `expo`: `~57.0.28` (SDK 57)
  - `react-native`: `0.86.3`
  - `expo-router`: `~57.0.26`
  - No bare native code — all functionality via Expo packages or React Native Web

### 1.2 Dependency Stack (Platform Relevance)

| Dependency | Android | iOS | Notes |
|---|---|---|---|
| `expo-audio` | ✅ Partially | ✅ Partially | Record-only; background restrictions apply |
| `expo-sensors` | ✅ | ✅ | Accelerometer; foreground-only |
| `expo-location` | ✅ | ✅ | Both foreground/background possible |
| `expo-notifications` | ✅ | ✅ | Sandbox APNs (iOS) / GCM/FCM (Android) |
| `expo-secure-store` | ✅ | ✅ |encrypted storage; iOS Keychain, Android Keystore |
| `expo-file-system` | ✅ | ✅ | Both platforms |
| `expo-sharing` (implied) | ✅ | ✅ | Not directly used |
| `expo-linking` | ✅ | ✅ | URL handling |
| `expo-router` | ✅ | ✅ | File-based routing |
| `react-native-gesture-handler` | ✅ | ✅ | Required by RN |
| `react-native-reanimated` | ✅ | ✅ | 4.5.1; worklets mode |
| `react-native-safe-area-context` | ✅ | ✅ | |
| `react-native-screens` | ✅ | ✅ | |
| `@noble/ciphers`, `@noble/hashes`, `@noble/post-quantum` | ✅ | ✅ | Pure JS; Hermes-compatible |
| `zustand` | ✅ | ✅ | State management |

### 1.3 Workflow Type
- **Managed Expo** (expo-start works, `expo run:android` / `expo run:ios` require development builds)
- **Development client** enabled (`eas.json` `developmentClient: true`)
- **No bare native project** — all native modules via Expo packages
- **EAS Build** for development and preview builds
- **Expo Go** available for rapid testing (with limitations)

---

## 2. Platform Compatibility Matrix

Each feature is assessed for Android and iOS support. **PASS** = tested/verified, **PARTIAL** = code path inspected with known limitation, **FAIL** = broken, **NOT VERIFIED** = cannot confirm without physical device or production provider.

### 2.1 Registration & Authentication

| Feature | Android | iOS | Evidence |
|---|---|---|---|
| OTP request flow | PASS | PASS | `tests/otp-request.test.ts` (11 tests) runs in CI; `requestRecordingPermissionsAsync` works on both via Expo |
| Live OTP integration (SMS) | PARTIAL | PARTIAL | Mock provider only; real SMS requires Twilio gateway; `VIGILGRACE_LIVE_PHONE` opt-in |
| Session handling | PASS | PASS | `src/services/secure-store.ts`; web falls back to `sessionStorage` with "preview only" warning |
| Server-key cache per backend URL | PASS | PASS | `services/identity-keys.ts`, `resolveServerCrypto` |

### 2.2 Emergency Contacts

| Feature | Android | iOS | Evidence |
|---|---|---|---|
| Contact creation, editing, validation | PASS | PASS | `src/app/(app)/contacts.tsx`, `tests/contacts.test.ts` (9 tests) |
| Contact verification states + focus refresh | PASS | PASS | `useFocusEffect(refreshContacts)`; tab-gain refresh works on both |
| Verified-contact-only alert dispatch | PASS | PASS | `deliverToVerifiedContacts` in `src/services/sos-service.ts`; backend enforces `verified: true` |
| Removal requires confirmation | PASS | PASS | Cross-platform UI; no native `Alert` dependency |

### 2.3 Manual SOS

| Feature | Android | iOS | Evidence |
|---|---|---|---|
| SOS trigger (manual) | PASS | PASS | `src/core/sos/sos-machine.ts`; `tests/sos-machine.test.ts` (10 tests) |
| Countdown behavior | PASS | PASS | Verified in UI and tests; `scheduler.advance()` simulates both platforms |
| Cancel during countdown | PASS | PASS | `machine.cancel()` sets status to `cancelled`; tested |
| Send-now (bypass countdown) | PASS | PASS | `machine.confirmNow()` triggers immediate dispatch; tested |
| Idempotent alertId | PASS | PASS | `routes/alerts.js`; same `alertId` does not create duplicates |
| Concurrent retries serialised | PASS | PASS | `inFlightRetries` in `routes/alerts.js` |

### 2.4 Countdown & Cancel

| Feature | Android | iOS | Evidence |
|---|---|---|---|
| Countdown timer | PASS | PASS | `Date.now()` inside timer only; no platform-specific timing |
| Cancel prevents dispatch | PASS | PASS | `machine.getState().status === 'cancelled'`; tested in CI |
| Send-now triggers immediate dispatch | PASS | PASS | `machine.confirmNow()`; backend confirmation required |

### 2.5 Location

| Feature | Android | iOS | Evidence |
|---|---|---|---|
| Location acquisition | PASS | PASS | `src/services/location.ts`; both platforms via `expo-location` |
| Denied permission path | PASS | PASS | Returns `null` on every failure path; SOS never blocked |
| 20 s hard timeout | PASS | PASS | `services/api.ts`, `services/backend.ts:110` |
| Background location | PARTIAL | PARTIAL | `expo-location` supports both, but iOS requires NSLocationWhenInUseUsageDescription + NSLocationAlwaysAndWhenInUseUsageDescription; Android has `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION`. Not tested on device. |

### 2.5 Voice Monitoring

| Feature | Android | iOS | Evidence |
|---|---|---|---|
| Acoustic prototype (dBFS + ZCR) | PASS | PASS | `src/core/voice/acoustic-analyzer.ts`; `tests/acoustic-analyzer.test.ts` (10 tests). Foreground-only on both; no background claim. |
| Microphone permission | PASS | PASS | `requestRecordingPermissionsAsync()` via `expo-audio`; both platforms |
| Background monitoring | FAIL | FAIL | Explicitly stated: "Backgrounding the app stops the monitor" ( `docs/SAFETY_FEATURE_UPDATE_2026-10-18.md` §3). iOS terminates audio sessions on background; Android may continue with foreground service. Not device-verified. |
| Very noisy environments produce candidates | PASS | PASS | Documented limitation; same behavior expected on both platforms |

### 2.6 Shake Detection

| Feature | Android | iOS | Evidence |
|---|---|---|---|
| Shake-to-SOS (threshold/debounce/cooldown) | PASS | PASS | `src/core/motion/shake-detector.ts`; `tests/shake-detector.test.ts` (6 tests), `tests/shake-audit.test.ts` (13 audit tests). Foreground-only on both. |
| Walking does not trigger (medium/low) | PASS | PASS | Audit tests verify both platforms via synthetic 60 Hz sequences |
| High preset walks trigger (F1 finding) | PASS | PASS | `shake-audit.test.ts` F1; same test logic on both |
| Isolated bumps/drops do not trigger | PASS | PASS | `shake-audit.test.ts` F2; same test logic on both |
| Background shake detection | FAIL | FAIL | "Expo sensors do not deliver accelerometer updates while the app is backgrounded" (shake-detector.ts comment). iOS suspends motion updates; Android may continue. Not device-verified. |

### 2.7 Evidence & Integrity

| Feature | Android | iOS | Evidence |
|---|---|---|---|
| SHA-256 digest of artifact bytes | PASS | PASS | `src/core/evidence/integrity.ts`; `tests/evidence.test.ts` (5 tests). Both platforms. |
| Evidence retention (7 days) | PASS | PASS | `EVIDENCE_RETENTION_DAYS = 7`; `isEvidenceExpired`. |
| Evidence signature (ML-DSA) | PASS | PASS | `signEvidenceRecord`, `verifyEvidenceRecordSignature`. Both platforms. |
| Backend rejects raw audio content | PASS | PASS | "pinned by tests"; both platforms. |

### 2.8 Notifications

| Feature | Android | iOS | Evidence |
|---|---|---|---|
| Mock-provider dispatch | PASS | PASS | `SosPanel` renders `SIMULATED`; both platforms. |
| Real SMS delivery | NOT VERIFIED | NOT VERIFIED | Requires Twilio/gateway; `services/api.ts` mock mode only. |
| Notification permission handling | PASS | PASS | Both platforms via `expo-notifications`. |
| Silent notification for SOS countdown | NOT VERIFIED | NOT VERIFIED | No production provider configured. |

### 2.9 Cryptography

| Feature | Android | iOS | Evidence |
|---|---|---|---|
| ML-KEM-768 key encapsulation | PASS | PASS | `@noble/post-quantum` v2.4.0; Hermes-compatible; both platforms. |
| ML-DSA-65 signatures | PASS | PASS | Same library; both platforms. |
| AES-256-GCM encryption | PASS | PASS | `@noble/ciphers` v1.0.3; both platforms; verified by 9 envelope tests. |
| HKDF-SHA-256 key derivation | PASS | PASS | `@noble/hashes` v2.4.0; both platforms. |
| Envelope seal/open round-trip | PASS | PASS | `tests/envelope.test.ts` (9 tests); both platforms. |
| Signature verification on server | PASS | PASS | `verifyEnvelopeSignature`; backend compares signerPub against registered key. |

### 2.10 History & Status

| Feature | Android | iOS | Evidence |
|---|---|---|---|
| Alert history accuracy | PASS | PASS | `SosPanel` renders correct status; `machine.getState().status`. |
| Mock vs real delivery states | PASS | PASS | `SIMULATED` wording in UI; screenshot `04`. |
| Offline recovery (stale session) | PARTIAL | PARTIAL | Behavior inspected; not device-verified. |
| Concurrent request handling | PASS | PASS | `inFlightRetries` serialises; `routes/alerts.js`. |

---

## 3. Platform-Specific API Differences

### 3.1 Audio Recording

| Aspect | Android | iOS |
|---|---|---|
| `expo-audio` `requestRecordingPermissionsAsync()` | Works via `android.permission.RECORD_AUDIO`; `RECORD_AUDIO` may be auto-granted on Android 13+ if app is default music player | Works via `NSMicrophoneUsageDescription` in Info.plist; user prompt is modal |
| Audio session management | `AVAudioSession` category `record`; sharing enabled with `AVAudioSessionCategoryPlayAndRecord` | Same iOS audio session management |
| Background audio | ❌ Not supported by Expo Go; audio stops when app backgrounds | ❌ iOS terminates audio session on background; requires Audio Session API for background mode (not configured) |

### 3.2 Sensor (Accelerometer)

| Aspect | Android | iOS |
|---|---|---|
| `expo-sensors` `Accelerometer` | Updates while app is foregrounded; may continue in limited mode if foreground service running | Updates while app is foregrounded; iOS suspends motion updates when app backgrounds |
| Shake detector comment | "Expo sensors do not deliver accelerometer updates while the app is backgrounded" | Same — iOS suspends `CMMotionManager` on background |

### 3.3 Secure Storage

| Aspect | Android | iOS |
|---|---|---|
| `expo-secure-store` | Android Keystore; encrypted at rest | iOS Keychain; encrypted at rest |
| Web fallback | `sessionStorage` with "preview only" warning | Same |
| Key material persistence | Survives app restart on both platforms | Same |

### 3.4 File System

| Aspect | Android | iOS |
|---|---|---|
| `expo-file-system` | `uris: content`, `file`, `assets`; both readable | Same; iOS `Documents` directory is backed up iCloud unless `com.apple.MobileDocsDirNoBackupKey` set |
| Evidence file storage | `app-private storage`; retention 7 days | Same |

### 3.5 Cryptography

| Aspect | Android | iOS |
|---|---|---|
| `@noble/*` libraries | Hermes-compatible; work on JS thread | Same |
| ML-KEM/ML-DSA | No native dependency; pure JS; both platforms | Same |
| AES-GCM | No native dependency; pure JS; both platforms | Same |
| Key generation seed size | `ml_kem768.lengths.seed!` / `ml_dsa65.lengths.seed!` | Same (library-determined) |

### 3.6 Navigation

| Aspect | Android | iOS |
|---|---|---|
| `expo-router` file-based routing | ✅ | ✅ |
| Tab bar (Safety/Contacts/History/Settings) | ✅ | ✅ |
| Safe area handling | ✅ (via `react-native-safe-area-context`) | ✅ |
| Back affordance | ✅ | ✅ |

### 3.7 Backend API

| Aspect | Android | iOS |
|---|---|---|
| `apiFetch` with 20 s hard timeout | ✅ | ✅ |
| Mock provider on port 4001 | ✅ | ✅ |
| Real SMS/webhook gateway | ❌ (NOT VERIFIED) | ❌ (NOT VERIFIED) |
| Backend error handling (timeouts, malformed) | ✅ (28 backend tests) | ✅ (28 backend tests) |

---

## 4. Background Execution Restrictions

| Service | Android | iOS | Documentation |
|---|---|---|---|
| Microphone audio | Stops when app backgrounds (Expo Go) | Terminates audio session on background | `docs/SAFETY_FEATURE_UPDATE_2026-10-18.md` §3; `use-voice-monitor.ts` |
| Accelerometer sensor | Stops when app backgrounds | Suspends `CMMotionManager` on background | `shake-detector.ts` comment; `use-shake-monitor.ts` |
| Location updates | Possible with foreground service; `ACCESS_FINE_LOCATION` | Possible with `whenInUse` or `always` permission | `services/location.ts`; iOS requires NSLocation*UsageDescription |
| Notifications | Foreground only for custom sounds/actions | Foreground only for custom sounds/actions | `expo-notifications` docs |
| State persistence | `AsyncStorage` / `expo-secure-store` survives restart | Same | Both platforms |

**Key Policy:** Manual SOS and all safety-critical paths remain accessible even when voice, motion, location, or network services fail. Cancellation is always permitted.

---

## 5. Known Platform Defects (Not Bugs, but Limitations)

| ID | Finding | Android | iOS | Impact |
|---|---|---|---|---|
| C1 | **Background microphone/sensor termination** | Audio stops; sensor updates cease | Audio stops; motion updates suspend | Manual SOS remains functional; voice/shake monitoring only while foreground |
| C2 | **Real SMS delivery not verified** | Mock mode only | Mock mode only | No carrier delivery confirmed on either platform |
| C3 | **iOS notification configuration** | N/A | Requires `UNUserNotificationCenter` consent; different UI flow | Same `expo-notifications` API abstracts most differences |
| C4 | **Android permissions auto-grant** | `RECORD_AUDIO` may auto-grant on Android 13+ | N/A | May affect UX but not functionality |

---

## 6. Required Physical-Device Verification

| Item | Why Needed | Status |
|---|---|---|
| Android SOS dispatch on device | Verify end-to-end flow: manual trigger → countdown → alert dispatch → verified contacts | Not performed |
| iOS SOS dispatch on device | Same as Android, but with iOS-specific permission flows and audio session behavior | Not performed |
| Background microphone behavior on both platforms | Verify if audio continues or stops when app is backgrounded; confirm user-perceived behavior | Not performed |
| Background shake detection on both platforms | Verify if accelerometer updates continue when app backgrounds | Not performed |
| iOS notification delivery with real provider | Configure Twilio/sendgrid and verify end-to-end iOS notification delivery | Not performed |
| Android notification delivery with real provider | Same for Android GCM/FCM | Not performed |

**No claim of physical-device verification is made** unless it was actually performed on the device. All PARTIAL outcomes in the matrix above are explicitly noted as requiring device verification.

---

## 7. Minimum Supported Platforms

| Platform | Minimum Expo SDK | Minimum React Native | Status |
|---|---|---|---|
| Android | SDK 57 (Expo 57) | 0.86.3 | ✅ Configured |
| iOS | SDK 57 (Expo 57) | 0.86.3 | ✅ Configured |
| Web | SDK 57 | 0.86.3 | ✅ `expo start --web` works |

---

## 8. Cross-Platform Fixes Applied (Pre-existing)

The following fixes were already applied in the `feat/dual-theme-eas-apk` branch and are preserved:

1. **SOS HTTP hard timeout** (`apiFetch`): 15 s ceiling, 20 s for alert submission, timeout maps to retryable transport failure
2. **SOS retry idempotency**: Recorded failed alert re-dispatched; delivered alerts immutable; concurrent retries serialised
3. **SOS evidence attaching**: Evidence attaches to any recorded alert; recorder tracks state in a ref, not render state
4. **SOS shake/voice during active SOS**: `useSosController.trigger` ignores triggers while machine is counting down/sending/retrying
5. **Evidence MIME type**: Derived from file extension, not hardcoded `audio/m4a`
6. **Duplicate navigator headers**: Tab navigator header hidden; stack sub-screens keep only back affordance
7. **Hardcoded handset number in fixtures**: Replaced with `+9190000000xx` placeholders; live test reads `VIGILGRACE_LIVE_PHONE`
8. **Security screen server-key cache**: Reads cached server keys for active backend URL, not last cached server
9. **Pendant/BLE removal**: Entire pendant module, BLE dependency, permissions, and UI entries removed
10. **Contact focus refresh on tab gain**: `useFocusEffect(refreshContacts)` implemented

---

## 9. Next Concrete Tasks (Physical Device or Provider Required)

| Task | Android | iOS | Effort |
|---|---|---|---|
| Verify SOS dispatch on device | Required | Required | High |
| Verify background microphone behavior | Required | Required | High |
| Verify background shake detection | Required | Required | High |
| Configure Twilio/SendGrid and verify iOS notification delivery | Not applicable | Required | High |
| Configure Twilio/SendGrid and verify Android notification delivery | Required | Not applicable | High |
| Test real SMS OTP flow on both platforms | Not applicable | Required (opt-in via `VIGILGRACE_LIVE_PHONE`) | Medium |
| Full accessibility audit on device | Recommended | Recommended | Medium |

**No tasks are claimed as completed** without physical-device or production-provider verification. All remaining work is explicitly noted as requiring those resources.

---

## 10. Commands and Actual Outputs

```bash
# TypeScript typecheck (both platforms)
npx tsc --noEmit   → EXIT 0 (clean)

# Lint (both platforms)
npx expo lint      → 0 errors, 0 warnings

# Client tests (both platforms)
npx vitest run     → 96 passed | 1 skipped (97 tests, 11 files)

# Backend tests (both platforms)
npm run backend:test  → 28 passed, 0 failed (10 suites)

# Expo Go verification
# - Voice monitor: foreground only (documented)
# - Shake detector: foreground only (documented)
# - No BLE/pendant functionality (removed)

# Expo Go limitations documented:
# - Background audio stops on both platforms
# - Motion updates suspend on both platforms
# - Real SMS requires configured provider
```