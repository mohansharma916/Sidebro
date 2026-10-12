# SideBro AI — Real-Time Second-Screen Interview Wingman

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-green.svg)](https://nodejs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-v12-E0234E.svg?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![React](https://img.shields.io/badge/React-v18-61DAFB.svg?logo=react&logoColor=black)](https://react.dev/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker&logoColor=white)](https://www.docker.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

> **Start listening on your computer. Let SideBro handle the answers on your phone.**

A real-time AI conversation wingman built around a **Second-Screen Architecture**. The computer being used for your meeting or technical interview captures microphone and system audio locally, while your phone, tablet, or secondary laptop placed next to your keyboard becomes your responsive AI workspace—delivering live transcripts, automatic question detection, sub-second streaming answers, key points, coding examples, follow-up questions, and notes.

---

## 🏗️ Architecture Overview

```text
PRIMARY LAPTOP (macOS / Windows)
  Zoom / Google Meet / Teams
            +
  SideBro Capture Agent (Electron Desktop / Web)
   ├── Microphone Audio (Tagged: YOU / Candidate)
   ├── System Audio (Tagged: OTHER / Interviewer)
   ├── Energy & WebAudio Voice Activity Detection (VAD)
   └── Secure WebSocket Streaming
            │
            ▼
NESTJS REAL-TIME BACKEND (Port 3001)
   ├── SessionModule: WebSocket Gateway (/ws) + REST Controllers (/api/sessions)
   ├── StorageModule: SQLite Persistent Engine (node:sqlite DatabaseSync)
   ├── AiModule: Streaming answers via Groq (default qwen/qwen3.8-27b) or Gemini, offline templates otherwise
   ├── ContextModule: Document Chunking & Keyword RAG Engine (Resume, JD, Notes)
   ├── SpeechModule: Dual-channel STT via Groq Whisper, falling back to OpenAI Whisper
   ├── AnalyticsModule: Debrief summaries, coding solutions log, Markdown export
   └── NetworkModule: LAN auto-discovery & dynamic QR code pairing
            │
            ▼
SIDEBRO SECOND SCREEN (Phone / Tablet / Browser)
   ├── Live Glanceable Current Question
   ├── Sub-Second Token Streaming (Direct Answer, Key Points, Code Snippets)
   ├── Answer Modes: [Quick] [Normal] [Detailed]
   ├── Action Chips: [Shorter] [Explain] [Example] [Tech Detail] [STAR]
   ├── Dual-Channel Speaker Transcript Feed (YOU vs OTHER)
   ├── Real-time Duration Clock & Hardware Status (0% Audio Drop)
   └── Post-Session Debrief & 1-Click Markdown Export
```

---

## ✨ Key Features

1. **Second-Screen Separation (Zero Call Interference)**:
   - Your primary laptop remains clean, uncluttered, and 100% free of suspicious windows during screen-sharing.
   - Your phone or tablet propped up on your desk becomes your discreet, responsive copilot.
2. **Instant QR Code & 6-Character Fast Pairing**:
   - Generates a random 6-character pairing code (e.g. `A7X9KP`) and a QR code. Pairing returns a per-session access token that every later request must present.
   - Scan directly with your mobile camera or in-app camera scanner to join in under 1 second.
3. **Dual-Channel Speaker Separation**:
   - `Microphone Audio` ➔ Tagged as `YOU` (Candidate).
   - `System Audio` ➔ Tagged as `OTHER` (Interviewer / Participant).
4. **Smart Question Detection & Debounce**:
   - Detects interrogatives ("How does Fiber work?", "Can you explain JSI?", "Tell me about a time...") and filters conversational fillers ("okay?", "right?").
   - Buffers fragmented speech so natural pauses don't trigger premature or duplicate answers.
5. **Context Grounding & RAG**:
   - Injects the Resume, Job Description, and Project Notes of the profile you select into the AI prompt. With no profile selected, no personal context is used and the AI is instructed never to invent experience.
   - A clearly-labelled **DEMO** profile is seeded for the simulator; it is never used unless you pick it.
6. **NestJS Modular Architecture**:
   - Built on `@nestjs/core`, `@nestjs/common`, and `@nestjs/platform-ws`.
   - Clear separation of concerns into dedicated modules: `SessionModule`, `AiModule`, `ContextModule`, `StorageModule`, `SpeechModule`, `AnalyticsModule`, and `NetworkModule`.
7. **SQLite Historical Persistence**:
   - Automatically records all sessions, transcripts, detected questions, streaming answers, coding snippets, notes, and context profiles into `server/data/copilot.sqlite` (override with `DATA_DIR`).
   - Retains analytics across server restarts for post-session debriefs and performance audits.
8. **Interactive Interview Simulator**:
   - Built-in test runner with pre-configured scenarios (Senior React Native Lead, Distributed Rate Limiter, STAR Incident Response) and 1-click test buttons to test the entire loop without needing a live call.
9. **Docker & Docker Compose Ready**:
   - Multi-stage production containerization with persistent volume mounts for SQLite.

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** (v20+ recommended, Node 22+ includes native `node:sqlite`)
- **npm** (v9+)

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration (Optional)
Create a `.env` file in the project root (see `.env.example` for all options):
```env
PORT=3001
GROQ_API_KEY=gsk_...           # Answers + Whisper speech-to-text (recommended)
GEMINI_API_KEY=...             # Optional answer provider (fallback after Groq)
OPENAI_API_KEY=sk-...          # Optional Whisper speech-to-text fallback
ADMIN_TOKEN=...                # Optional: enables cross-session admin endpoints
```
*(With no LLM key, SideBro streams clearly-labelled offline templates: general explanations for a few known topics and answer structures otherwise. It never makes up personal experience.)*

### 4. Run Development Servers
Starts both the NestJS backend (`port 3001`) and the Vite frontend (`port 5173`):
```bash
npm run dev
```

- **Desktop Capture Agent**: Open [http://localhost:5173/](http://localhost:5173/) on your laptop.
- **Second Screen on Mobile**: On your phone or tablet (connected to the same WiFi), scan the QR code or navigate to `http://<your-lan-ip>:5173/?join=CODE`.

### 5. Run as Native Electron App (macOS / Windows)
```bash
npm run electron
```
Electron loads the Vite dev server, or the built client served by the backend at `http://127.0.0.1:3001` (`npm run build && npm start`).
System-audio loopback capture is reliable on Windows; on macOS check that the captured stream actually contains an audio track.

### 6. Build for Production
```bash
npm run build
npm run start
```

---

## 🐳 Docker Deployment

Run the complete stack (NestJS backend + Nginx frontend) with Docker Compose:

```bash
# Build and start containers in the background
npm run docker:up
# Or directly with Docker:
docker compose up -d --build

# View container logs
docker compose logs -f

# Stop containers
npm run docker:down
```

- **Client App**: [http://localhost:5173/](http://localhost:5173/)
- **NestJS API**: [http://localhost:3001/api/health](http://localhost:3001/api/health)
- **Persistent Data**: Automatically saved to Docker volume `sidebro-data` (mapped to `/app/server/data`).

---

## 🧪 Testing

```bash
npm test        # builds the server and runs unit, storage and in-process API/WebSocket tests (node:test)
npm run e2e     # demo walkthrough against a running server on :3001 (npm start in another terminal)
```

CI (`.github/workflows/ci.yml`) runs the build (including type-checking) and `npm test` on every push.

---

## 🔐 Security Model

- Every `/api/sessions/:id/*` route and every WebSocket join requires the session token (`x-session-token` header, or `?token=` on download links). A socket only receives events for a session after a validated `session.join`.
- Pairing codes expire after 12 hours and stop working once a session ends.
- CORS and WebSocket origins are limited to localhost and private LAN addresses (add more with `CORS_ORIGINS`).
- Cross-session endpoints (`GET /api/sessions`, `/api/analytics/overview|search|coding-solutions`) are disabled unless `ADMIN_TOKEN` is set.
- `/api/profiles` has no authentication: anyone on your network can read or change profiles. Run the server on a network you trust.

---

## 🛠️ Project Structure

```text
INTERVIEW_HELP/
├── docker-compose.yml         # Docker orchestration (sidebro-backend + sidebro-client)
├── .dockerignore              # Docker build exclusions
├── server/                    # NestJS Backend API & WebSocket Server
│   ├── Dockerfile             # Multi-stage production container
│   ├── tsconfig.json          # Experimental decorators & emitDecoratorMetadata
│   ├── src/
│   │   ├── main.ts            # NestJS application bootstrap (WsAdapter, CORS)
│   │   ├── app.module.ts      # Root NestJS application module
│   │   ├── session/           # Session management, controller, gateway, simulation
│   │   ├── storage/           # SQLite persistence module
│   │   ├── ai/                # Groq / Gemini streaming engine (offline templates fallback)
│   │   ├── common/            # Auth guards, validation, rate limiting, origin checks
│   │   ├── context/           # RAG profile & document chunking engine
│   │   ├── speech/            # Whisper STT status and audio ingestion
│   │   ├── analytics/         # Session debriefs & coding solutions log
│   │   └── network/           # Health checks and LAN IP resolution
│   ├── data/                  # SQLite storage folder (copilot.sqlite)
│   ├── test/                  # node:test suites (npm test)
│   └── test-e2e.ts            # Demo walkthrough against a running server
├── client/                    # Vite + React + TypeScript + Vanilla CSS
│   ├── Dockerfile             # Nginx production container
│   ├── nginx.conf             # Reverse proxy config for API and WebSockets
│   ├── src/
│   │   ├── App.tsx            # Main router: Desktop Agent, Second Screen, Join
│   │   ├── index.css          # Ultra-modern dark mode design system
│   │   ├── components/
│   │   │   ├── AudioVisualizer.tsx # Dual-channel canvas waveform
│   │   │   ├── DeviceHealthBar.tsx # Hardware & connection status
│   │   │   ├── QRCodeDisplay.tsx   # Crisp SVG QR Code generator
│   │   │   ├── StreamingAnswer.tsx # Rich formatted answers with action chips
│   │   │   ├── TranscriptFeed.tsx  # Dual-channel live conversation feed
│   │   │   ├── AskAIModal.tsx      # Manual queries & quick prompt chips
│   │   │   └── InterviewSimulator.tsx # 1-click scenario test runner
│   │   ├── views/
│   │   │   ├── DesktopAgentView.tsx# Primary device capture HUD
│   │   │   ├── SecondScreenView.tsx# Second device AI workspace
│   │   │   ├── JoinSessionView.tsx # 6-character code fast pairing
│   │   │   ├── ContextProfileView.tsx # Resume & JD manager
│   │   │   └── PostSessionView.tsx # Review metrics & markdown export
│   │   └── hooks/
│   │       ├── useWebSocket.ts    # Auto-reconnecting WebSocket hook
│   │       └── useAudioCapture.ts # Mic & system audio capture with VAD
├── electron/
│   ├── main.cjs               # Native Electron desktop window setup
│   └── preload.cjs            # Secure IPC bridge (contextIsolation = true)
└── README.md                  # Documentation
```

---

## 👤 Author

**Mohan Sharma**
- GitHub: [@mohansharma916](https://github.com/mohansharma916)

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
