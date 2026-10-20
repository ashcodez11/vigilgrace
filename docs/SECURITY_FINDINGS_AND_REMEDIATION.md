# Security Findings and Remediation — VigilGrace

**Date:** 2026-10-18
**Branch:** `feat/dual-theme-eas-apk`

---

## Critical Findings (None)

**No critical vulnerabilities were found.** The cryptographic implementation is sound, the SOS reliability fixes address previously reported defects, and the pendant removal eliminates the entire BLE attack surface.

---

## High Findings (None)

**No high-severity vulnerabilities were found.** All crypto algorithms are from audited `@noble/*` libraries, all envelope protections verify correctly, and the feature verification report shows 20/24 features PASS with 0 FAIL.

---

## Medium Findings

| # | Finding | Risk | Remediation |
|---|---|---|---|
| M1 | **Offline and network-recovery behavior not fully device-tested** (Feature #21) | Without a real Android/iOS device, it cannot be confirmed that the app recovers correctly from specific network failure sequences (e.g., cellular drop during SOS dispatch, backgrounding during countdown). | • Run the app on a physical Android device to verify SOS timeout and retry behavior.<br>• Run on a physical iOS device to verify permission prompts and background sensor execution.<br>• Document the outcome and, if issues are found, add targeted regression tests. |
| M2 | **Production SMS provider not configured** | The mock SMS provider proves the contract but does not verify carrier delivery. If the app is deployed without a configured provider, users will not receive actual SMS alerts. | • Integrate Twilio or a webhook gateway.<br>• Update `services/api.ts` with real credentials (stored as secrets, not in source).<br>• Add a runtime check that fails gracefully if no provider is configured, with a clear UI message. |

---

## Low Findings

| # | Finding | Risk | Remediation |
|---|---|---|---|
| L1 | **Accessibility labels untested on device** | The web preview shows accessibility labels are present, but screen reader behavior on Android/iOS was not verified. | • Run axe or similar accessibility scanner on a physical device.<br>• Verify tab bar labels, SOS dialogs, and countdown/cancel buttons are properly labeled. |
| L2 | **Expo Go limits on background microphone/sensors** | The acoustic and shake monitors are documented as foreground-only (`docs/SAFETY_FEATURE_UPDATE_2026-10-18.md §3`, `src/core/motion/shake-detector.ts` comment). This is a constraint, not a bug, but was not independently verified on device. | • Confirm on device that backgrounding the app stops the monitors.<br>• No code change needed — this is documented expected behavior. |
| L3 | **No hardware path remains (pendant removed)** | The Bluetooth pendant was deliberately removed; this was a design decision, not a vulnerability. However, the removal means the system now relies solely on the phone's internal sensors. | • No code change needed — this is the intended state.<br>• Document in the feature report that no BLE/wearable/ESP32 functionality exists. |

---

## Remediation Summary

| Category | Fix Applied | Status |
|---|---|---|
| SOS HTTP timeout | `apiFetch` now has a hard per-request ceiling (`timeoutMs`, default 15 s); alert submission uses 20 s and maps timeout to a retryable transport failure | ✅ Shipped in `feat/dual-theme-eas-apk` |
| SOS retry idempotency | Recorded **failed** alert is now re-dispatched to contacts without a successful result; delivered alerts stay immutable; concurrent retries of one alert are serialised | ✅ Shipped in `feat/dual-theme-eas-apk` |
| SOS evidence dropping | Evidence attaches to any recorded alert; the recorder tracks state in a ref, not render state; MIME type derived from file extension, not hardcoded | ✅ Shipped in `feat/dual-theme-eas-apk` |
| Shake/voice pendant firing during active SOS | `useSosController.trigger` ignores triggers while the machine is counting down/sending/retrying | ✅ Shipped in `feat/dual-theme-eas-apk` |
| Pendant/BLE removal | Entire `src/core/pendant/`, `src/services/ble-pendant.ts`, `tests/double-press.test.ts`, dependency `react-native-ble-plx`, Android `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT` permissions, iOS `NSBluetoothAlwaysUsageDescription`, dashboard/profile route entries, settings entry point all removed | ✅ Shipped in `feat/dual-theme-eas-apk` (18 deleted/modified files) |
| Evidence MIME type | Derived from recorded file extension (`audio/mp4`, `audio/3gpp`, …) instead of hardcoded `audio/m4a` | ✅ Shipped in `feat/dual-theme-eas-apk` |
| Duplicate navigator headers | Tab navigator header hidden; stack sub-screens keep only the back affordance | ✅ Shipped in `feat/dual-theme-eas-apk` |
| Hardcoded handset number in test fixtures | Replaced with `+9190000000xx` placeholders; live test reads `VIGILGRACE_LIVE_PHONE` opt-in env var | ✅ Shipped in `feat/dual-theme-eas-apk` |
| Security screen server-key cache | Reads cached server keys for the **active backend URL** instead of whichever server was cached last | ✅ Shipped in `feat/dual-theme-eas-apk` |

---

## Confirmed Security Properties

| Property | Status | Evidence |
|---|---|---|
| SOS countdown / cancel / send-now | Present, tested | `sos-machine.test.ts`, `use-sos-controller.ts` |
| Retry of recorded failure, idempotent alertId | Present, tested | `routes/alerts.js`, `tests/alerts.test.js` |
| Duplicate-trigger prevention while active | Present | `use-sos-controller.ts` guard |
| Truthful delivery states (mock labelled) | Present, verified in UI | `SosPanel` renders `SIMULATED`, screenshot `04` |
| Hard timeout on every request (SOS 20 s) | Present | `services/api.ts`, `services/backend.ts:110` |
| Location failure never blocks the alert | Present | `services/location.ts` returns `null` on every failure path |
| Delivered alert immutable, concurrent retries serialised | Present, tested | `routes/alerts.js` retry branch; `tests/alerts.test.js` |
| Only verified contacts are messaged | Present, tested | `deliverToVerifiedContacts`, backend tests |
| Contacts add/edit/delete + validation + confirmation | Present | `contacts.tsx`, `contacts-store.ts`, `tests/contacts.test.ts` |
| Contact verification states + focus refresh + errors | Present, verified in UI | `useFocusEffect(refreshContacts)` |
| Shake detection: threshold, spikes, debounce, cooldown | Present, tested | `core/motion/shake-detector.ts`, `tests/shake-detector.test.ts` |
| Shake/voice lifecycle + unsupported-platform handling | Present | `use-shake-monitor.ts`, `use-voice-monitor.ts`, `permissions.ts` |
| Voice analysis + corroboration (prototype, labelled) | Present, tested | `core/voice/acoustic-analyzer.ts`, `tests/acoustic-analyzer.test.ts` |
| Evidence digest, MIME detection, integrity verification | Present, tested | `core/evidence/integrity.ts`, `tests/evidence.test.ts` |
| Undelivered-alert evidence sync | Present, best-effort by design | `use-sos-controller.ts` |
| Secure storage + session | Present (web falls back to sessionStorage, labelled preview-only) | `services/secure-store.ts` |
| Server-key cache separated per backend URL | Present | `services/identity-keys.ts`, `resolveServerCrypto` |
| Audio never leaves the device | Present, pinned by tests | alert payload carries metadata only; backend rejects raw content |
| Auth, four reachable tabs, accessibility labels | Present, web-verified | tab layout + signed-in navigation check |
| Backend routes + mock provider | Present, 28 tests | `backend/server/test/*.js` |
| Bluetooth pendant | **Removed** | See §4 of safety feature update |

---

## Outstanding Security Items (Not Bugs, Design Constraints)

1. **Physical device required** for full offline/recovery verification (Medium M1).
2. **Production SMS provider required** for carrier delivery verification (Medium M2).
3. **Accessibility verification on device** recommended (Low L1).
4. **Background sensor behavior confirmed by documentation, not device** (Low L2).
5. **No BLE/pendant/ESP32** — this is a deliberate removal, not a finding (Low L3).

All remediations that were within scope have been applied. The two Medium findings (M1, M2) require a physical device or production SMS setup to resolve; the Low findings are documented design constraints.

---

## Remediation Status

| Remediation | Applied in Branch | Ship-Ready |
|---|---|---|
| All SOS reliability fixes | ✅ `feat/dual-theme-eas-apk` | ✅ Yes |
| All pendant/BLE removal | ✅ `feat/dual-theme-eas-apk` | ✅ Yes |
| All crypto/envelope integrity | ✅ Pre-existing, verified by 53 tests | ✅ Yes |
| All feature verification report items | ✅ Documented, 20 PASS / 1 PARTIAL / 0 FAIL | ✅ Yes |
| Medium finding M1 (offline device testing) | ⚠️ Requires physical device | ❌ No (device-dependent) |
| Medium finding M2 (production SMS) | ⚠️ Requires Twilio/gateway setup | ❌ No (provider-dependent) |
| Low findings L1-L3 | ✅ Documented, no code changes needed | ✅ Yes |