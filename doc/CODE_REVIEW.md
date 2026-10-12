# SideBro AI — Code Review Report

**Date:** 2026-10-12  
**Scope:** Whole repository at commit `5d30c3b` (server, client, electron, Docker, tests)  
**Method:** Read all source files, type-checked and built both packages, started the backend locally (no API keys, scratch data directory), ran the bundled tests, and wrote reproduction scripts for each suspected bug.

---

## 0. Fix status (updated 2026-10-12)

Most findings below are now fixed and covered by `npm test` (30 `node:test` tests, including an in-process API/WebSocket suite that reproduces each bug in §2).

| Finding | Status |
|---|---|
| 2.1 duplicate ingestion | ✅ One channel (WS, REST only as fallback) + idempotent `clientId` on the server |
| 2.2 candidate speech triggers answers | ✅ Detector only considers `OTHER`; candidate speech flushes the buffer |
| 2.3 no access control | ✅ Per-session token on REST + WS join; rooms only via validated join; origin-checked CORS/WS; `ADMIN_TOKEN` for cross-session endpoints; `/api/speech/config` removed; crypto codes with 12 h TTL; ended sessions read-only. ⚠️ `/api/profiles` is still unauthenticated (documented in README) |
| 2.4 invented experience | ✅ No default-profile fallback; offline templates rewritten (no first-person claims); prompt forbids inventing experience; demo profile clearly labelled and not auto-selected |
| 2.5 canned text leaks into LLM answers | ✅ Provider answers start empty and are filled only from model output |
| 2.6 DB path | ✅ Module-relative path + `DATA_DIR`; Docker sets it to the volume. ⚠️ Docker images not rebuilt here (daemon not running) |
| 2.7 broken tests | ✅ Replaced by `node:test` suites; `npm test` at root; CI workflow added |
| S1–S3, S5–S17 | ✅ Except S17 statement caching (not done) |
| S4 memory | ◐ History now loaded lazily; in-memory lists still grow for sessions used during a run |
| C1–C4, C6, C8 | ✅ C4 (pause-based audio segmentation) compiles but was **not tested with a real microphone** |
| C5 binary audio frames, C7 component split | ❌ Not done |
| E1, E2 | ✅ Electron loads `http://127.0.0.1:3001` (backend now serves `client/dist`) instead of `file://`; permissions limited to app origins |
| E3 macOS loopback | Documented only |
| R1–R4 | ✅ Legacy `index.ts` deleted; `shared/types.ts` canonical (client re-exports it, test keeps the server copy identical); Vite alias removed; README corrected |
| Phase 4 lint/logging | ❌ ESLint/Prettier and `Logger` migration not done. `strict: true` now on for server and client |

---

## 1. Verdict

**Does it work?** Yes, the happy path works. Both packages compile with no errors, the client production build succeeds, the backend boots, and the bundled end-to-end test (`npx tsx server/test-e2e.ts`) passes all 7 steps.

**Is it good?** It's a working prototype, not production-ready. Several bugs show up in normal use, not just edge cases:

| Area | Rating | Summary |
|---|---|---|
| Builds / type-checks | ✅ Good | `tsc` is clean on server and client (server is even clean under `--strict`) |
| Core real-time loop | ⚠️ Works, with bugs | Every transcript is ingested **twice**, so questions are duplicated |
| AI answers | ❌ Serious issues | Offline/fallback mode and the default profile produce **made-up personal experience** |
| Security | ❌ None | No authentication; anyone on the LAN who knows a session id can read the live stream |
| Persistence | ⚠️ Buggy | The SQLite file location depends on the working directory; Docker data is **not** saved in the volume |
| Tests | ⚠️ Weak | 2 of 4 test scripts crash on startup; there is no `npm test` script and no assertions-based runner |
| Code structure | ⚠️ Duplicated | Legacy 874-line Express server kept next to the NestJS one; types copied 3 times |

---

## 2. Verified bugs (reproduced)

All of these were reproduced against a running backend with a script (in-memory session, offline mode).

### 2.1 Every transcript is ingested twice → duplicated questions (High)

`client/src/App.tsx:267` sends each final transcript over the WebSocket **and** `client/src/App.tsx:270` POSTs the same text to `/api/sessions/:id/transcripts`. The server treats each one as a separate utterance.

**Reproduced:**
```
1) transcripts stored for one utterance: 2
   detected question text: "How does the React Fiber reconciliation work? How does the React Fiber reconciliation work?"
```
Effects: the DB holds duplicate rows, the question detector's buffer concatenates both copies, and the LLM receives a doubled question. The same "WS + REST belt-and-braces" pattern is also used for pause, resume and end (`App.tsx` ~L505–535), which creates double writes and calls `generateSummary` twice.

**Fix:** pick one channel for ingestion (WebSocket), make the server de-duplicate by a client-generated id, and use REST only as a fallback when the socket is down.

### 2.2 The candidate's own speech triggers answers (High)

`server/src/questionDetector.ts:25` has the comment *"Only detect questions asked by OTHER speaker"*, but nothing in the code filters by speaker.

**Reproduced:** `YOU: "Can you repeat what the caching strategy question was?"` → **1 question detected** and an answer generated.

**Fix:** `if (transcript.speaker !== 'OTHER') return;` at the top of `ingestTranscript` (or make it a session setting).

### 2.3 Any socket can listen to any session (Critical, security)

`server/src/session/session.gateway.ts:229-235` adds the client to a session's broadcast set whenever **any** message carries a `sessionId`, even a `ping`. It doesn't check a join, a code or a token.

**Reproduced:** a second socket that only sent `{event:"ping", sessionId}` received
`transcript.final, question.detected, answer.started, answer.token`.

Related:
- No auth on any REST route. Anyone on the network can `GET /api/sessions` (lists every session with its **pairing code**), `DELETE /api/sessions/:id`, download full transcripts from `/api/analytics/debug/:id`, or **replace the server's API keys** via `POST /api/speech/config`.
- `app.enableCors({ origin: true, credentials: true })` (`server/src/main.ts:21`) lets any website the user visits call these APIs on `localhost:3001`.
- Session codes use `Math.random()` and never expire. Ended sessions can still be looked up by code, and they keep accepting transcripts (reproduced: `200` / `success: true` after `end`).
- A client's socket is never removed from its old session set when it sends a different `sessionId`.

**Fix:** issue a per-session secret on create/join (in the QR URL) and require it on the WebSocket join and every REST call. Only add a socket to a room in `session.join` after it's validated. Use `crypto.randomInt` for codes, expire them, and reject writes to ended sessions. Restrict CORS to the client origin. Remove `/api/speech/config`, or protect it.

### 2.4 Fallback answers invent personal experience (High, correctness & user risk)

With no API key (or when Groq/Gemini fail), `server/src/aiEngine.ts` returns hard-coded "expert" answers written in the first person:

**Reproduced:** `"Tell me about a time you faced a challenge"` →
*"During a Black Friday traffic surge, our primary Redis cluster hit 98% memory capacity… I led the incident response…"*

- `aiEngine.ts:214` answers anything containing "performance" or "improved" with *"I improved application performance by 42%…"*.
- `aiEngine.ts:242` sends any question containing the word **"time"** (e.g. "what is the time complexity…") to the Black Friday STAR story.
- `aiEngine.ts:359-385` returns the **same** sliding-window function for every coding question.

There is a second problem on top of this. `server/src/contextEngine.ts:141-143` falls back to a **seeded fictional resume** ("Staff Mobile Engineer @ Apex Streaming…", `contextEngine.ts:19-62`) whenever the session has no profile. Reproduced: a session with no profile used context `["resume","jobDescription","projectNotes"]`. So even the real LLM is told the user has experience they don't have.

**Fix:** remove the default-profile fallback (no profile means no context). Make the offline engine clearly say *"No AI provider configured"* instead of making up answers. Treat the seeded profile as a demo fixture that's only loaded in mock/simulator mode.

### 2.5 Canned answer leaks into real LLM answers (Medium)

`aiEngine.ts:51-77` always builds the canned template answer and broadcasts it via `onStart`, even when Groq is configured. After streaming, `aiEngine.ts:720-723` only overwrites `keyPoints` / `followUpQuestions` when the LLM output parses. If the model skips the expected headings, the **canned key points stay** in the stored answer next to the real text.

**Fix:** start with empty fields when a real provider is used, and fill them only from parsed model output.

### 2.6 Docker and local runs write the database to the wrong place (High, data loss)

`server/src/storageEngine.ts:58` resolves `path.resolve(process.cwd(), 'server/data')`.
- In Docker, `WORKDIR /app/server` (`server/Dockerfile:46`), so the DB goes to `/app/server/server/data`, **outside** the `VOLUME /app/server/data` (`Dockerfile:42`). All history is lost when the container is recreated.
- Locally, both `server/data/` and `server/server/data/` already exist in this checkout, so history is split depending on how the server was started. (`.gitignore` even has an entry for `server/server/`.)

**Fix:** resolve relative to the module (`new URL('../data', import.meta.url)`) or read a `DATA_DIR` env var, and set it in Docker.

### 2.7 Two bundled tests are broken (Medium)

`server/test/test-sqlite-storage.mjs:1` and `server/test/test-verify-fixes.mjs:23` import `./server/dist/...`, which resolves to `server/test/server/dist/...`. Both crash with `ERR_MODULE_NOT_FOUND`. `test-coding-storage.mjs` "passes" but prints `archive count: undefined`. None of the scripts set a non-zero exit code reliably, and there is no `npm test`.

---

## 3. Other issues found by reading the code

### Server
| # | Location | Issue |
|---|---|---|
| S1 | `session/session.service.ts:20-24`, `sessionManager.ts:26-29` | `super()` creates its own `StorageEngine` and loads all sessions, then the injected one is swapped in and everything loads **again**. The DB is opened twice (visible in the startup log). |
| S2 | `session/session.service.ts:27-31` | `onModuleDestroy` calls `pauseSession` on **every** session, which rewrites even *ended* sessions to `paused`. It's latent today only because `enableShutdownHooks()` is not called. |
| S3 | `sessionManager.ts:38-48`, `171-177` | Sessions restored from SQLite get no duration timer, and `resumeSession` never creates one, so the clock freezes after a restart. `durationSeconds` is only persisted on status changes, so a crash loses it. |
| S4 | `sessionManager.ts:17-24` | Every session's transcripts, questions and answers are loaded into memory at boot and kept forever, so memory grows without bound. |
| S5 | `sessionManager.ts:331-349` | The "analytics" are hard-coded: topics are matched on React/JSI keywords, and average latency defaults to fake values (`500`, `420`). |
| S6 | `aiEngine.ts:550-596` | Gemini: the API key is in the URL. `streamGenerateContent` is called without `alt=sse`, so the response is a JSON array split over many lines, and the line-by-line `JSON.parse` (with no buffering across chunks) will mostly fail. As written, Gemini streaming is likely to produce empty output. |
| S7 | `aiEngine.ts:660`, `speechEngine.ts:225` | `fetch` calls have no timeout or `AbortController`, so a hung provider blocks the answer forever. Answers also can't be cancelled when a new question arrives, so concurrent streams overlap. |
| S8 | `aiEngine.ts:667`, `README.md` | Model `qwen/qwen3.8-27b` doesn't match the README ("Llama 3.3/Qwen 2.5"). Check that it exists on Groq. Qwen3-family models may emit `<think>` blocks, which the parser doesn't strip. |
| S9 | `aiEngine.ts:19,24` | The OpenAI key is read but never used for answers, and `OLLAMA_HOST` is never read. The README advertises both. |
| S10 | `session.gateway.ts:179-188` | Each token event re-sends the whole `accumulated` text, so bandwidth is O(n²) per answer. Its `answerId` is the **question** id, not the answer id. |
| S11 | `session.gateway.ts:91-97` | The primary device is removed immediately on any socket drop (no grace period like the phone gets). |
| S12 | `context/*` | Profiles live only in memory and are lost on restart, even though sessions persist the profile JSON. |
| S13 | `main.ts:27-28` | 50 MB JSON body limit on every route, which is a DoS risk. Nest's built-in parser is also still registered. Use `app.useBodyParser` with a limit per route. |
| S14 | `session.controller.ts`, gateway | No input validation (no DTOs / `ValidationPipe`). `answerLength`, `modifier`, `type` and `category` are trusted as-is. |
| S15 | `sessionManager.ts:108-111` | Duplicated `sessions.set` / `codeToSessionId.set` lines. |
| S16 | `analytics.controller.ts:66` | The exported markdown always labels code fences `typescript`. |
| S17 | `storageEngine.ts` | Statements are re-`prepare`d on every call, and multi-table deletes are not in a transaction. |

### Client
| # | Location | Issue |
|---|---|---|
| C1 | `App.tsx:183-192` | `answer.token` ignores `answerId` and writes into whatever `currentAnswer` is, so two overlapping answers interleave. |
| C2 | `hooks/useWebSocket.ts:112-122, 161-169` | Unmount closes the socket, then `onclose` schedules a reconnect anyway. Under `React.StrictMode` (`main.tsx:147`) this causes an extra connection in dev. There's no backoff. |
| C3 | `hooks/useWebSocket.ts:138-158` | A queued `session.join` plus the auto-rejoin in `onopen` sends the join twice. |
| C4 | `hooks/useAudioCapture.ts:57` | Fixed 2.5 s MediaRecorder segments cut words at the boundaries, and Whisper gets no context between segments. Stop/restart between segments drops audio. Latency adds up: 2.5 s slice + STT + a 2–3.2 s detector debounce. |
| C5 | `App.tsx:278-299` | Audio is sent as base64 inside JSON (+33% size) over HTTP for each slice. A binary WebSocket frame would be cheaper. |
| C6 | `App.tsx:302-321, 324+` | Polling every 3 s runs alongside the WebSocket, which is extra load and a source of races. |
| C7 | `App.tsx` (732 lines), `DesktopAgentView.tsx` (758) | Very large components that hold all state. Use a reducer or store (e.g. `useReducer` / Zustand). |
| C8 | `App.tsx:~545` | `handleJoinSession` throws after a successful WS fallback, so the user sees an error even when the join works. |

### Electron / Docker / repo
| # | Location | Issue |
|---|---|---|
| E1 | `electron/main.cjs:82-84` | `setPermissionCheckHandler` always returns `true` for every origin. Restrict it to the app's origin. |
| E2 | `electron/main.cjs:39,52` | Falling back to `loadFile(...)` puts the app on `file://`, where every relative `fetch('/api/...')` fails. Only the WebSocket has a `file:` special case. |
| E3 | `electron/main.cjs:91` | `audio: 'loopback'` system-audio capture is reliable on Windows. On macOS, test it before depending on it, and handle the "no audio track" case in the UI. |
| R1 | `server/src/index.ts` (874 lines) | A legacy duplicate Express server that is still compiled. The Nest services are thin `extends` wrappers around the old engine classes and use `(this as any)` to reach private fields. |
| R2 | `server/src/types.ts`, `client/src/types.ts`, `shared/types.ts` | Three copies of the types that have already drifted (`'manual'` category and `mock.*` events are missing from two of them). |
| R3 | `client/vite.config.ts:9-12` | Aliases `react` to `client/node_modules/react`. With npm workspaces it may be hoisted to the root, which can break a clean install or Docker build. `dedupe` alone is enough. |
| R4 | `README.md` | Claims that don't match the code: "encrypted" session code, OpenAI/Ollama answer providers, Llama 3.3 / Qwen 2.5 models, data in `server/data`. |

---

## 4. Ways to improve (prioritised roadmap)

### Phase 1: Fix correctness (1–2 days)
1. Ingest each transcript **once** (2.1), and filter question detection to `OTHER` (2.2).
2. Remove the default-profile fallback and the first-person canned answers (2.4). Return a clear "no provider" message instead.
3. Stop the canned answer from leaking into real answers (2.5). Tag tokens with the real `answerId` and route them by id on the client (S10, C1).
4. Fix the DB path with a `DATA_DIR` env var and point it at the Docker volume (2.6).
5. Fix the test import paths and add `"test"` scripts that exit non-zero on failure (2.7).

### Phase 2: Security baseline (2–3 days)
1. Per-session secret token in the QR link. Validate it on WS `session.join` and on REST calls (a Nest `Guard`).
2. Only `session.join` may add a socket to a room. Remove the auto-subscribe on every message.
3. Lock CORS to the client origin. Delete `/api/speech/config` or make it local-only.
4. `crypto.randomInt` codes with a TTL. Reject transcripts and asks for ended or paused sessions.
5. `ValidationPipe` + DTOs (`class-validator`) for every body. Per-route body limits. Rate-limit `/transcribe-audio` and `/ask` (`@nestjs/throttler`).

### Phase 3: Reliability & performance
1. `AbortController` with timeouts on every provider call. Cancel the in-flight answer when a newer question arrives.
2. Send token **deltas** only. Batch tokens every ~50 ms.
3. Stream audio as binary WebSocket frames. Replace fixed 2.5 s slices with VAD-gated, overlapping segments, or use a streaming STT (e.g. a realtime transcription API) to cut latency.
4. Persist profiles to SQLite. Load sessions lazily instead of all at boot. Persist duration periodically and recreate timers on resume.
5. Fix Gemini streaming (`alt=sse` + line buffering, key in the `x-goog-api-key` header), or remove it. Implement or remove the OpenAI and Ollama options so the README matches the code.

### Phase 4: Maintainability
1. Delete `server/src/index.ts`. Fold the `*Engine` classes into real Nest providers that receive `StorageService` through DI (no `(this as any)`).
2. Make `shared/types.ts` the single source of truth (a workspace package or TS path alias) and import it from both sides.
3. Split `App.tsx` into a session store (reducer/Zustand) + views. Remove the 3 s polling once the WebSocket is reliable.
4. Use a real test framework (Vitest or Jest): unit tests for `QuestionDetector`, `parseStructuredSections` and `ContextEngine`, plus e2e tests that start the Nest app in-process on a random port with a temp DB.
5. Add ESLint + Prettier and CI (build, typecheck, test) on each push. Turn on `strict: true` (the server already passes; the client has 1 error).
6. Replace `console.*` with Nest's `Logger`. Avoid logging transcript contents.

### Phase 5: Product
- Real analytics: derive topics from the LLM or embeddings instead of keyword lists, and measure latency instead of using defaults.
- Better retrieval: replace keyword overlap with embeddings (e.g. a small local embedding model + SQLite vector extension).
- Lean into **practice mode**: the mock interviewer + post-session debrief is the strongest, lowest-risk part of the product (see note below).

---

## 5. Note on product risk

The README describes using the tool covertly during live interviews ("100% free of suspicious windows during screen-sharing"). Many employers and interview platforms treat undisclosed real-time AI help as misconduct, and it can lead to rescinded offers or bans. The fabricated-experience problems in §2.4 make this worse, because a user could repeat claims that aren't true about themselves. Positioning the product as an interview **practice / rehearsal** coach, or as a disclosed meeting assistant, avoids this risk and fits the features that already work well (simulator, debrief, export).

---

## Appendix A: Commands run

```bash
npx tsc --noEmit -p server          # OK (also OK with --strict)
npx tsc --noEmit -p client          # OK (1 error with --strict)
npx vite build                      # OK, 421 kB JS (131 kB gzip)
node server/dist/main.js            # boots; StorageEngine initialised twice
npx tsx server/test-e2e.ts          # ALL 7 STEPS PASSED
node server/test/test-coding-storage.mjs   # passes, prints "archive count: undefined"
node server/test/test-sqlite-storage.mjs   # ERR_MODULE_NOT_FOUND
node server/test/test-verify-fixes.mjs     # ERR_MODULE_NOT_FOUND
npm audit --omit=dev                # 0 vulnerabilities
```

## Appendix B: Reproduction output

```
1) transcripts stored for one utterance: 2
   detected question text: ["How does the React Fiber reconciliation work? How does the React Fiber reconciliation work?"]
3) spy (never joined) received events: pong,transcript.final,question.detected,answer.started,answer.token
2) questions created from YOU speech: 1
4) offline answer: During a Black Friday traffic surge, our primary Redis cluster hit 98% memory capacity causing a cache-stampede incident
5) context sources used with no profile: ["resume","jobDescription","projectNotes"]
6) ended session code lookup status: 200 | transcript accepted after end: true
```
