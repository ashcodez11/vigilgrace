# VigilGrace — phone-verification (OTP) delivery: diagnosis, fix and evidence

Date: 2026-10-16 · Branch: `feat/dual-theme-eas-apk` (uncommitted working tree)
Test number supplied by the owner: redacted here (`+91XXXXXXXXXX`). The number itself is not stored in this repository.

## 1. Trace: UI → API → provider

| Step | Where |
| --- | --- |
| Button "Send verification code" (only rendered for **unverified** contacts) | `src/app/(app)/contacts.tsx` |
| State + error handling | `src/state/contacts-store.ts` → `sendVerification` |
| Typed client call | `src/services/backend.ts` → `requestContactVerification` → `POST /contacts/:id/send-verify` |
| Transport + error mapping | `src/services/api.ts` → `apiFetch` |
| Route handler | `backend/server/src/routes/contacts.js` |
| Provider adapters | `backend/server/src/delivery/providers.js` (mock / twilio / webhook) |

Account registration is email + password (`/auth/register`). The app has **no** login-by-phone OTP; the only code-based
verification in the codebase is emergency-contact verification (verified by search: the sole callers are
`requestContactVerification` / `verifyContact`).

## 2. What was actually wrong

1. **No backend existed at all.** `backend/contact-service` and `backend/server` were empty directories, untracked and
   absent from git history and from the project archive; the app calls `http://localhost:4001` (→ `10.0.2.2:4001` on an
   Android emulator) and `package.json` already scripted `backend:start` / `backend:test`. So there was no server to
   receive the request, no provider, and no configuration — the request could never have produced an SMS.
2. **The client reported the wrong reason.** `apiFetch` let the raw transport error (`TypeError: Network request failed`)
   escape, and the store displayed `err.message` — so an unreachable server surfaced as a meaningless string, while a real
   server-side reason (HTTP 503 body `{error, delivery}`) was flattened into a generic message.
3. **The UI could claim a code existed when none did.** `sendVerification` entered the "enter the 6-digit code" state for
   any response, including `delivery: 'unknown'` — a code that was never generated.
4. **Defect found only by running it live:** a **verified** contact could be re-sent unlimited codes. The resend cooldown
   was measured against the live code record, which verification deletes, so `send → verify → send → …` bypassed the
   limiter entirely and would have spent real SMS. Live proof before the fix: `resend to an already-verified contact → 200`.

Ruled out: phone-number format (the API's own validator accepts an E.164 test number), rate limits (nothing was ever
sent), CORS (the server answers preflights and the app is native), and wrong API base (no `EXPO_PUBLIC_API_URL` and no
`config/local.config.json`, so the documented default is what the app uses).

## 3. Changes

**Backend restored** (dependency-free Node, `node:http` only):

- `backend/server/package.json` — `start` / `test` scripts, no dependencies.
- `backend/server/src/index.js`, `src/app.js` — listener, routing, CORS/preflight, health, error boundary.
- `backend/server/src/routes/auth.js` — register / login / me / keys; sessions stored as SHA-256 digests; passwords salted.
- `backend/server/src/routes/contacts.js` — contact CRUD + `send-verify` / `verify`; codes stored as salted digests,
  single-use, expiring, attempt-limited, resend-limited; a changed number never inherits verification.
- `backend/server/src/delivery/providers.js` — mock (dev only, behind `VIGILGRACE_ALLOW_MOCK=1`), Twilio, generic webhook.
  Reports **provider acceptance**, never handset delivery. Refuses with 503 when nothing is configured.
- `backend/server/src/crypto/credentials.js`, `src/util/http.js`, `src/util/store.js`.

**Fixes:**

- `backend/server/src/routes/contacts.js` — separate, actionable reasons; **409 for an already-verified contact**;
  cooldown anchored on the last request for the contact (survives the code being consumed/expired).
- `src/services/api.ts` — new `BackendUnreachableError` (distinct from `ApiError`) so a transport failure is reported as
  "cannot reach the backend … nothing was sent", and the server's HTTP reason is preserved on `ApiError.body`.
- `src/state/contacts-store.ts` — `isDispatchedDelivery()` guard: code entry (and `verifyRequestedAt`) only when a
  provider actually accepted a code; otherwise the true reason is shown and nothing is claimed.
- `src/app/(app)/contacts.tsx` — copy no longer says a code was "sent to the contact"; it states provider acceptance is
  not proof of handset delivery.

**Tests:** `backend/server/test/otp.test.js` (15 tests), `tests/otp-request.test.ts` (11 tests) and the opt-in
`tests/otp-live-integration.test.ts` (real store + real HTTP; skipped unless `VIGILGRACE_LIVE_BASE` points at a running
server). Both stubbed suites were also run against a pre-fix copy in an isolated directory to prove they fail without the
fix — 5/11 client and 2/15 backend — so they pin the defect rather than merely passing.

## 4. Evidence (live, over HTTP, against the restored backend)

Provider **not** configured (the default, and the state this repo would deploy in):

```
GET  /health                          200 smsProvider=unknown
POST /contacts (owner number)         201 phone=+********5336
send-verify without session           401 Not signed in.
send-verify (no provider)             503 delivery=unknown
  reason shown to the app             No SMS provider is configured on the server, so no verification code was sent. …
  code returned?                      no — nothing generated
repeat refusal                        503
```

Dev **mock** delivery (explicit `VIGILGRACE_ALLOW_MOCK=1`; no SMS is sent):

```
send-verify (mock provider)           200 delivery=mock
verify with wrong code                400 Incorrect verification code. 4 attempt(s) left.
verify with dispatched code           200 verified=true
reuse the consumed code               400 No verification code was requested for this contact.
resend to an already-verified contact 409 This contact is already verified, so no new code was sent. …
back-to-back resend (unverified)      429 Verification requested too recently — try again later
```

Logs contain no code, no full phone number and no token (checked by grep); the stored record holds only a 64-hex digest,
and a consumed record is deleted rather than kept.

Cross-origin behaviour, **observed** rather than inferred (an Expo-web-style client, `Origin: http://localhost:8081`):

```
OPTIONS /contacts/x/send-verify      -> 204 with Access-Control-Allow-Origin/Headers/Methods
POST    /contacts/x/send-verify      -> 401 (no session) with the same CORS headers
```

The app's own client code was then driven against a live backend process — real `apiFetch`, real socket, no `fetch`
stubbing: register → create contact → `sendVerification` (`delivery: mock`, code-entry state) → immediate repeat
(cooldown error) → `confirmVerification` (true) → `refresh` (contact verified server-side) → resend (409 →
"already verified", no code-entry state). A genuinely closed port produced
`Cannot reach the VigilGrace backend at http://127.0.0.1:4299 … nothing was sent`, i.e. the transport path was proven
against a real refused connection, not a simulated throw.

## 5. Acceptance status

- The one OTP request for the owner's number was **not** initiated: there is no authorized provider configured anywhere in
  this project and no deployed backend to serve it, so a real send was impossible rather than refused. No SMS was sent,
  and nothing was faked. The reasoning above applies to the *service*, not just this machine.
- No OTP value was ever exposed: in mock mode the code is generated locally and returned to the calling app only; it is
  never logged and never stored in plaintext.

### Checks and their honest status

| Check | Result |
| --- | --- |
| `npm test` (client) | 68 passed, 1 skipped (69), exit 0 |
| `npm run backend:test` | 15/15, exit 0 |
| `npx tsc --noEmit` | exit 2 — **16 pre-existing errors**, unchanged from the baseline, none in the files changed here |
| `npm run lint` | exit 1 — 19 pre-existing problems elsewhere (voice-monitor, index, shake-monitor, identity-keys; the BLE service named here was removed on 2026-10-18); only a pre-existing unused-`refresh` warning sits in a file touched here |
| `npm run verify` | **red**, because it chains the two pre-existing failures above. Its four stages were run individually (see rows above) |
| live client→server integration | 2/2 exit 0 with `VIGILGRACE_LIVE_BASE` set; skipped by default |

The one skipped test is the opt-in live-server case, documented in the file; the unreachable-backend case in the same
file always runs.

## 6. To send a real code

1. Run or deploy the backend (`npm run backend:install && npm run backend:start`, or the host of your choice).
2. Point the app at it if it is not `localhost:4001` — `EXPO_PUBLIC_API_URL`, or `config/local.config.json` →
   `{"apiBaseUrl": "https://…"}`.
3. Configure exactly one authorized provider **on the server**, via environment variables only:
   `VIGILGRACE_SMS_PROVIDER=twilio` with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`
   (or `VIGILGRACE_SMS_WEBHOOK_URL` for any other gateway). Nothing is invented and no credential belongs in source.
4. `GET /health` must report `smsProvider: twilio` (or `webhook`) before any code can be dispatched.
5. Only then request a code from the app for the owner's handset. `delivery: twilio` means the provider accepted it; it does
   not prove the handset received it.

## 7. Known gaps (not part of the OTP fix)

The app also calls `/alerts`, `/alerts/:id`, `/alerts?limit=`, `/alerts/:id/evidence` and a server-crypto endpoint. Those
are **not** implemented by the restored backend, so the SOS delivery, history and security screens will 404 until that
slice is built. Nothing in this change touches them.
