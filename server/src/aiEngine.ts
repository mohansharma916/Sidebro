import { AnswerLengthMode, DetectedQuestion, GeneratedAnswer, SessionType } from './types.js';
import { DocumentChunk } from './contextEngine.js';

import dns from 'dns';

export interface AnswerStreamCallbacks {
  onStart: (answer: GeneratedAnswer) => void;
  onToken: (token: string) => void;
  onComplete: (answer: GeneratedAnswer) => void;
  onError: (err: any) => void;
}

export type AnswerModifier = 'shorter' | 'expand' | 'example' | 'technical_detail' | 'star' | 'alternative';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

/** Hard cap on a single answer stream, so a hung provider never blocks forever. */
const PROVIDER_TIMEOUT_MS = 45_000;
const OFFLINE_MODEL = 'offline-templates (no AI provider configured)';

/** Tracks whether a provider already emitted tokens, so we never splice two providers' output together. */
interface StreamState {
  accumulated: string;
  emitted: boolean;
}

/**
 * Removes <think>...</think> reasoning blocks that some models (e.g. Qwen3) emit before the answer.
 * Works incrementally on streamed deltas.
 */
export class ThinkFilter {
  private inThink = false;
  private pending = '';

  push(delta: string): string {
    this.pending += delta;
    let out = '';
    while (this.pending.length > 0) {
      if (this.inThink) {
        const end = this.pending.indexOf('</think>');
        if (end === -1) {
          // keep a tail in case the closing tag is split across chunks
          this.pending = this.pending.slice(-8);
          return out;
        }
        this.pending = this.pending.slice(end + '</think>'.length);
        this.inThink = false;
      } else {
        const start = this.pending.indexOf('<think>');
        if (start === -1) {
          // hold back a possible partial "<think" at the end
          const lt = this.pending.lastIndexOf('<');
          if (lt !== -1 && '<think>'.startsWith(this.pending.slice(lt))) {
            out += this.pending.slice(0, lt);
            this.pending = this.pending.slice(lt);
          } else {
            out += this.pending;
            this.pending = '';
          }
          return out;
        }
        out += this.pending.slice(0, start);
        this.pending = this.pending.slice(start + '<think>'.length);
        this.inThink = true;
      }
    }
    return out;
  }

  flush(): string {
    const rest = this.inThink ? '' : this.pending;
    this.pending = '';
    return rest;
  }
}

export class AIEngine {
  private groqApiKey: string | undefined;
  private geminiApiKey: string | undefined;
  private groqModel: string;
  private geminiModel: string;

  constructor() {
    this.groqApiKey = process.env.GROQ_API_KEY;
    this.geminiApiKey = process.env.GEMINI_API_KEY;
    this.groqModel = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
    this.geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  }

  /**
   * Generates a streaming answer for a detected question
   */
  public async streamAnswer(
    question: DetectedQuestion,
    sessionType: SessionType,
    lengthMode: AnswerLengthMode,
    contextChunks: DocumentChunk[],
    recentTranscripts: { speaker: string; text: string }[],
    callbacks: AnswerStreamCallbacks,
    actionModifier?: AnswerModifier,
    signal?: AbortSignal
  ): Promise<void> {
    const startTime = Date.now();

    const answerId = `ans-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const contextSummary = contextChunks.map(c => `[${c.source.toUpperCase()}]: ${c.content}`).join('\n\n');
    const hasProvider = !!(this.groqApiKey || this.geminiApiKey);

    // With a real provider the answer starts empty and is filled only from the model's output,
    // so no template text can leak into it.
    const answer: GeneratedAnswer = {
      id: answerId,
      questionId: question.id,
      sessionId: question.sessionId,
      questionText: question.questionText,
      directAnswer: '',
      keyPoints: [],
      followUpQuestions: [],
      fullContent: '',
      isComplete: false,
      lengthMode,
      model: this.groqApiKey ? `${this.groqModel} (Groq)` : this.geminiApiKey ? this.geminiModel : OFFLINE_MODEL,
      contextUsed: contextChunks.map(c => c.source),
      timestamp: Date.now(),
    };

    const state: StreamState = { accumulated: '', emitted: false };
    const emit = (token: string) => {
      if (!token) return;
      if (!state.emitted) {
        answer.firstTokenLatencyMs = Date.now() - startTime;
        state.emitted = true;
      }
      state.accumulated += token;
      callbacks.onToken(token);
    };

    if (!hasProvider) {
      const structured = this.generateStructuredResponse(
        question.questionText,
        question.type,
        sessionType,
        lengthMode,
        contextChunks,
        actionModifier
      );
      answer.directAnswer = structured.directAnswer;
      answer.keyPoints = structured.keyPoints;
      answer.exampleOrSnippet = structured.exampleOrSnippet;
      answer.followUpQuestions = structured.followUpQuestions;
      callbacks.onStart(answer);
      await this.simulateTokenStream(structured.fullContent, emit, signal);
      this.finish(answer, state, startTime, callbacks, false);
      return;
    }

    callbacks.onStart(answer);

    const providers: { name: string; run: (sig: AbortSignal) => Promise<void> }[] = [];
    if (this.groqApiKey) {
      providers.push({
        name: 'Groq',
        run: sig => this.streamFromGroq(question.questionText, sessionType, lengthMode, contextSummary, recentTranscripts, actionModifier, emit, sig),
      });
    }
    if (this.geminiApiKey) {
      providers.push({
        name: 'Gemini',
        run: sig => this.streamFromGemini(question.questionText, sessionType, lengthMode, contextSummary, recentTranscripts, actionModifier, emit, sig),
      });
    }

    let lastError: any;
    for (const provider of providers) {
      const sig = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)])
        : AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
      try {
        answer.model = provider.name === 'Groq' ? `${this.groqModel} (Groq)` : this.geminiModel;
        await provider.run(sig);
        this.finish(answer, state, startTime, callbacks, true);
        return;
      } catch (err) {
        lastError = err;
        if (signal?.aborted) {
          // Superseded by a newer question: keep whatever was streamed so far.
          this.finish(answer, state, startTime, callbacks, true);
          return;
        }
        if (state.emitted) {
          // Failed mid-stream. Falling back now would splice two different answers together.
          console.warn(`[AIEngine] ${provider.name} stream failed after output started:`, (err as Error)?.message);
          this.finish(answer, state, startTime, callbacks, true);
          callbacks.onError(new Error(`${provider.name} stream was interrupted; the answer may be incomplete.`));
          return;
        }
        console.warn(`[AIEngine] ${provider.name} failed before output, trying next provider:`, (err as Error)?.message);
      }
    }

    // Every configured provider failed before producing output.
    answer.model = OFFLINE_MODEL;
    const structured = this.generateStructuredResponse(
      question.questionText, question.type, sessionType, lengthMode, contextChunks, actionModifier
    );
    answer.directAnswer = structured.directAnswer;
    answer.keyPoints = structured.keyPoints;
    answer.exampleOrSnippet = structured.exampleOrSnippet;
    answer.followUpQuestions = structured.followUpQuestions;
    callbacks.onError(new Error(`AI provider unavailable (${lastError?.message || 'unknown error'}); showing offline template.`));
    await this.simulateTokenStream(structured.fullContent, emit, signal);
    this.finish(answer, state, startTime, callbacks, false);
  }

  private finish(
    answer: GeneratedAnswer,
    state: StreamState,
    startTime: number,
    callbacks: AnswerStreamCallbacks,
    parseSections: boolean
  ): void {
    if (parseSections) {
      const parsed = this.parseStructuredSections(state.accumulated);
      answer.directAnswer = parsed.directAnswer;
      answer.keyPoints = parsed.keyPoints;
      answer.exampleOrSnippet = parsed.exampleOrSnippet;
      answer.followUpQuestions = parsed.followUpQuestions || [];
    }
    answer.fullContent = state.accumulated;
    answer.isComplete = true;
    answer.totalLatencyMs = Date.now() - startTime;
    callbacks.onComplete(answer);
  }

  /**
   * High-fidelity structured response generator for interview questions
   */
  private generateStructuredResponse(
    questionText: string,
    category: string,
    sessionType: SessionType,
    lengthMode: AnswerLengthMode,
    context: DocumentChunk[],
    modifier?: string
  ): {
    directAnswer: string;
    keyPoints: string[];
    exampleOrSnippet?: string;
    followUpQuestions?: string[];
    fullContent: string;
  } {
    const qLower = questionText.toLowerCase();

    // 1. React Fiber & Reconciliation
    if (qLower.includes('fiber') || (qLower.includes('react') && qLower.includes('reconciliation'))) {
      const direct = "React Fiber is React's complete rewrite of the reconciliation algorithm that introduces interruptible rendering, priority-based updates, and concurrent scheduling to prevent UI frame drops.";
      const points = [
        "**Interruptible Rendering**: Divides rendering work into small units (fibers) that can yield execution to the browser event loop for high-priority inputs (e.g., typing, animations).",
        "**Two-Phase Architecture**: Render/Reconciliation phase (pure, async, can be paused/aborted) vs. Commit phase (synchronous DOM mutations).",
        "**Priority-Based Scheduling**: Uses Lane-based scheduler to assign priorities (e.g. Immediate, UserBlocking, Normal, Low, Idle).",
        "**Double Buffering**: Maintains current fiber tree (visible on screen) and workInProgress fiber tree (in-memory clone being computed), swapping root pointers upon commit."
      ];
      const snippet = `// Conceptual Fiber Node structure
interface FiberNode {
  tag: WorkTag;            // FunctionComponent, ClassComponent, HostComponent
  key: null | string;
  type: any;
  stateNode: any;          // Real DOM element reference
  child: FiberNode | null; // First child link
  sibling: FiberNode | null; // Next sibling link
  return: FiberNode | null;  // Parent link
  lanes: Lanes;            // Priority lanes
  memoizedState: any;      // Hook linked list
  alternate: FiberNode | null; // Double-buffering partner
}`;
      const followUps = [
        "How do React 18 Transitions (useTransition) utilize Fiber lanes?",
        "What is the difference between the Render phase and Commit phase in Fiber?",
        "How does Fiber handle error boundaries during reconciliation?"
      ];

      return this.formatAnswer(direct, points, snippet, followUps, lengthMode, modifier);
    }

    // 2. React Native Bridge vs JSI (JavaScript Interface)
    if (qLower.includes('jsi') || (qLower.includes('bridge') && qLower.includes('react native'))) {
      const direct = "JSI (JavaScript Interface) is a lightweight C++ interface that enables direct, synchronous, and asynchronous memory references between JavaScript (Hermes/V8) and native C++/Java/Objective-C code, eliminating the JSON serialization overhead of the legacy Bridge.";
      const points = [
        "**No JSON Serialization Overhead**: Legacy Bridge serialized every call to JSON strings over an async queue; JSI exposes HostObjects directly in JS global memory.",
        "**Synchronous Invocation**: JS can call native methods synchronously and receive returned values immediately (critical for Bluetooth, crypto, UI gestures).",
        "**TurboModules & Fabric**: TurboModules use JSI to lazy-load native modules on demand; Fabric uses JSI for direct C++ DOM shadow tree manipulation.",
        "**Engine Agnostic**: JSI abstracts the JavaScript engine, allowing seamless swaps between Hermes, V8, or JavaScriptCore."
      ];
      const snippet = `// C++ JSI HostObject binding example
class FastCryptoModule : public jsi::HostObject {
public:
  jsi::Value get(jsi::Runtime& rt, const jsi::PropNameID& name) override {
    if (name.utf8(rt) == "sha256") {
      return jsi::Function::createFromHostFunction(
        rt, name, 1,
        [](jsi::Runtime& rt, const jsi::Value& thisVal, const jsi::Value* args, size_t count) {
          std::string input = args[0].asString(rt).utf8(rt);
          std::string hash = computeSha256(input); // Direct native execution
          return jsi::String::createFromUtf8(rt, hash);
        }
      );
    }
    return jsi::Value::undefined();
  }
};`;
      const followUps = [
        "Why are TurboModules faster to initialize than legacy NativeModules?",
        "How does Fabric use JSI to avoid layout thrashing across threads?",
        "What are the safety concerns when calling synchronous native functions in JSI?"
      ];

      return this.formatAnswer(direct, points, snippet, followUps, lengthMode, modifier);
    }

    // 3. Mobile list / rendering performance (conceptual techniques, no invented results)
    if (qLower.includes('flatlist') || (qLower.includes('performance') && (qLower.includes('react') || qLower.includes('mobile') || qLower.includes('list')))) {
      const direct = "Typical levers for React / React Native performance are list virtualization with view recycling, avoiding unnecessary re-renders, and moving heavy work off the JS thread. Back any claim with numbers from your own projects.";
      const points = [
        "**View Recycling**: Recycling lists (e.g. FlashList) reuse native cells instead of creating and destroying views during fast scrolls.",
        "**Render Optimization**: `React.memo`, stable callbacks (`useCallback`) and smaller state slices stop cascading re-renders.",
        "**Off-Thread Work**: Move large data transforms or hashing to background threads (JSI modules, workers) so the UI thread keeps 60 FPS.",
        "**Measure First**: Profile with Flipper / React DevTools / platform profilers and track FPS, JS frame time and TTI before and after."
      ];
      const snippet = `// Virtualized list configuration
<FlashList
  data={items}
  estimatedItemSize={88}
  renderItem={renderItem}
  keyExtractor={item => item.id}
/>`;
      const followUps = [
        "How do you profile memory leaks on iOS and Android?",
        "Which performance metrics do you track in production?",
        "How do you keep nested scroll views smooth?"
      ];

      return this.formatAnswer(direct, points, snippet, followUps, lengthMode, modifier);
    }

    // 4. Behavioral STAR question: give structure, never invent the candidate's story
    if (category === 'Behavioral' || /\btell me about a time\b|\bdescribe a (situation|time)\b|\bbiggest challenge\b/.test(qLower)) {
      const ownNotes = context.find(c => c.source === 'projectNotes') || context[0];
      const direct = ownNotes
        ? `Answer with a real example from your own experience. Closest match in your profile: "${ownNotes.content.slice(0, 160)}${ownNotes.content.length > 160 ? '…' : ''}"`
        : "Answer with a real example from your own experience using the STAR structure. Add project notes to your profile to get a suggested example here.";
      const points = [
        "**Situation (S)**: One or two sentences of context: team, system, stakes.",
        "**Task (T)**: What you specifically were responsible for.",
        "**Action (A)**: The concrete steps *you* took and why; this should be most of the answer.",
        "**Result (R)**: Measurable outcome and what you learned or changed afterwards."
      ];
      const followUps = [
        "What would you do differently next time?",
        "How did you communicate with stakeholders during this?",
        "What was the hardest trade-off you had to make?"
      ];

      return this.formatAnswer(direct, points, undefined, followUps, lengthMode, modifier);
    }

    // 5. Idempotency & Reliable API Design (PRD §39)
    if (qLower.includes('idempot') || qLower.includes('retry') || qLower.includes('duplicate request')) {
      const direct = "Idempotency ensures that an API operation can be repeated multiple times without changing the result beyond the initial application, critical for safe retries in network failures and payment processing.";
      const points = [
        "**Idempotency-Key Header**: Clients attach a unique UUID (`Idempotency-Key`) to mutate requests (POST/PATCH).",
        "**Atomic Lock & Deduplication**: The API gateway acquires a distributed lock in Redis for the key; if in-flight, it rejects concurrent duplicates with HTTP 409 or waits.",
        "**Persisted Response Cache**: Once the business transaction succeeds, cache the HTTP status and response payload with a TTL (e.g. 24h) keyed by `userId + idempotencyKey`.",
        "**HTTP Verb Guarantees**: GET, PUT, DELETE are idempotent by HTTP RFC spec; POST is non-idempotent by default and requires explicit application-level idempotency tokens."
      ];
      const snippet = `// Express.js Idempotency Middleware pattern
export async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['idempotency-key'] as string;
  if (!key) return next();

  const cacheKey = \`idemp:\${req.user.id}:\${key}\`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    const { status, body } = JSON.parse(cached);
    return res.status(status).json(body);
  }

  // Intercept response to store result
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    redis.set(cacheKey, JSON.stringify({ status: res.statusCode, body }), 'EX', 86400);
    return originalJson(body);
  };
  next();
}`;
      const followUps = [
        "How do you handle a request that is still processing when a duplicate retry arrives?",
        "What is the difference between Idempotency and Deduplication?",
        "How does the Transactional Outbox pattern support idempotent downstream events?"
      ];

      return this.formatAnswer(direct, points, snippet, followUps, lengthMode, modifier);
    }

    // 6. Distributed Rate Limiter (Only when question specifically asks about rate limiting)
    if (qLower.includes('rate limit') || qLower.includes('throttl')) {
      const direct = "To design a distributed rate limiter, I would utilize a Redis cluster running Token Bucket or Sliding Window Log algorithms with local token-leaky in-memory tiering to handle 100k+ RPS with sub-millisecond overhead.";
      const points = [
        "**Algorithm**: Sliding Window Counter in Redis (sorted sets or atomic Lua scripts with Redis INCR and EXPIRE).",
        "**High Availability**: Multi-region Redis clusters with active-active replication; if Redis is unreachable, fail-open with local in-process token buckets to protect availability.",
        "**Client Identification**: Composite key based on Authenticated User ID + Client IP + API Tier header.",
        "**Headers & Feedback**: Return standard RFC headers: \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\`, and \`Retry-After\` on HTTP 429."
      ];
      const snippet = `-- Redis Lua Script for Atomic Sliding Window Counter
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local clearBefore = now - window

redis.call('ZREMRANGEBYSCORE', key, 0, clearBefore)
local currentRequests = redis.call('ZCARD', key)

if currentRequests < limit then
  redis.call('ZADD', key, now, now)
  redis.call('EXPIRE', key, window / 1000)
  return 1 -- Allowed
else
  return 0 -- Rejected (429)
end`;
      const followUps = [
        "How do you handle race conditions between distributed rate limiter nodes?",
        "What are the trade-offs between Token Bucket vs Leaky Bucket vs Sliding Window Log?",
        "How would you implement tier-based rate limiting with payment plans?"
      ];

      return this.formatAnswer(direct, points, snippet, followUps, lengthMode, modifier);
    }

    // 7. General System Design (When asked about architecture, scaling, or distributed design)
    if (category === 'System Design' || qLower.includes('design a') || qLower.includes('scale') || qLower.includes('architect')) {
      const direct = `To design a resilient architecture for "${questionText.replace(/\?$/, '')}", I establish a decoupled microservices topology with API gateway routing, multi-tier caching (CDN + Redis), and asynchronous event streaming (Kafka) for linear horizontal scalability.`;
      const points = [
        "**Tiered Architecture**: Edge Cloudflare CDN for static/cachable responses → Kong/Envoy API Gateway with token authentication → Stateless Microservices on Kubernetes.",
        "**Data Tiering & Partitioning**: Read-heavy replica pools with Redis caching layer; write paths partitioned by consistent hashing or tenant ID.",
        "**Asynchronous Decoupling**: Offload non-blocking workflows to Apache Kafka / RabbitMQ with Dead Letter Queues (DLQ) for at-least-once delivery guarantees.",
        "**Resilience & Observability**: Circuit breakers (Resilience4j), distributed tracing (OpenTelemetry/Jaeger), and automated auto-scaling triggers on CPU/RPS."
      ];
      const snippet = `// Conceptual Distributed System Gateway Architecture
// Client -> Anycast CDN -> API Gateway -> Envoy Service Mesh -> Microservices
// Write Path: Service -> Kafka Topic -> Consumer Worker -> Primary DB
// Read Path:  Service -> Redis Cluster (Cache-Aside) -> Read Replica DB`;
      const followUps = [
        "How do you handle data consistency across microservices (Saga pattern vs 2PC)?",
        "How would you partition the database as throughput increases by 10x?",
        "What are the disaster recovery (DR) RPO and RTO targets for this system?"
      ];

      return this.formatAnswer(direct, points, snippet, followUps, lengthMode, modifier);
    }

    // 6. Coding question: a problem-solving checklist (a real solution needs an AI provider)
    if (category === 'Coding' || sessionType === 'coding' || /\b(algorithm|complexity|binary tree|linked list|dynamic programming|write a function|implement)\b/.test(qLower)) {
      const direct = `Offline mode cannot write a solution for "${questionText.replace(/\?$/, '')}". Use this checklist to work through it out loud.`;
      const points = [
        "**Clarify**: Restate the problem, confirm input size, constraints, and expected output with an example.",
        "**Brute Force First**: State the simplest correct approach and its time/space complexity.",
        "**Optimize**: Look for repeated work: hash maps, two pointers, sorting, sliding window, memoization.",
        "**Edge Cases & Tests**: Empty input, single element, duplicates, very large values; walk through one test by hand."
      ];
      const followUps = [
        "Can you improve the time or space complexity?",
        "How would this change if the input did not fit in memory?",
        "Which tests would you write for this function?"
      ];

      return this.formatAnswer(direct, points, undefined, followUps, lengthMode, modifier);
    }

    // 7. Generic / Fallback Technical Question
    const direct = `No AI provider is configured, so there is no specific answer for "${questionText.replace(/\?$/, '')}". Structure your answer around the points below.`;
    const points = [
      `**Core Concept**: Leverage standard patterns and idiomatic conventions for ${category.toLowerCase()} architecture.`,
      "**Trade-off Analysis**: Balance time complexity vs space complexity, latency vs throughput, and consistency vs availability.",
      "**Production Readiness**: Ensure comprehensive unit test coverage, structured logging, distributed tracing, and graceful error boundaries.",
      "**Practical Insight**: Ground solutions in real metrics, caching strategies, and resilient fallback states."
    ];
    // No unrelated dummy code snippet for generic or conceptual questions
    const snippet = undefined;
    const followUps = [
      "What are the main edge cases and failure modes for this solution?",
      "How does this implementation scale when data volume grows by 10x?",
      "How would you write integration tests to verify this behavior?"
    ];

    return this.formatAnswer(direct, points, snippet, followUps, lengthMode, modifier);
  }

  /**
   * Formats the answer according to length mode and modifiers
   */
  private formatAnswer(
    direct: string,
    points: string[],
    snippet: string | undefined,
    followUps: string[],
    lengthMode: AnswerLengthMode,
    modifier?: string
  ): {
    directAnswer: string;
    keyPoints: string[];
    exampleOrSnippet?: string;
    followUpQuestions?: string[];
    fullContent: string;
  } {
    let finalDirect = direct;
    let finalPoints = [...points];
    let finalSnippet = snippet;

    if (modifier === 'shorter' || lengthMode === 'quick') {
      finalPoints = finalPoints.slice(0, 2);
      finalSnippet = undefined;
    } else if (modifier === 'technical_detail' || lengthMode === 'detailed') {
      finalPoints.push("**Low-Level Nuance**: Memory layout, cache locality, and atomic operations ensure high concurrency safety.");
    } else if (modifier === 'alternative') {
      finalPoints.push("**Alternative Approach**: Contrast with event-driven asynchronous queues (Kafka/RabbitMQ) for batch vs immediate processing.");
    }

    let fullMarkdown = `### Direct Answer\n${finalDirect}\n\n### Key Points\n`;
    finalPoints.forEach(p => {
      fullMarkdown += `• ${p}\n`;
    });

    if (finalSnippet && lengthMode !== 'quick') {
      fullMarkdown += `\n### Code / Architecture Example\n\`\`\`typescript\n${finalSnippet}\n\`\`\`\n`;
    }

    if (followUps && followUps.length > 0) {
      fullMarkdown += `\n### Anticipated Follow-up Questions\n`;
      followUps.forEach((f, i) => {
        fullMarkdown += `${i + 1}. ${f}\n`;
      });
    }

    fullMarkdown += `\n> Offline template. Set GROQ_API_KEY or GEMINI_API_KEY for answers specific to the question.\n`;

    return {
      directAnswer: finalDirect,
      keyPoints: finalPoints,
      exampleOrSnippet: finalSnippet,
      followUpQuestions: followUps,
      fullContent: fullMarkdown,
    };
  }

  /**
   * Streams template text word-by-word so offline answers render like real ones.
   */
  private async simulateTokenStream(
    fullContent: string,
    emit: (token: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const tokens = fullContent.split(/(\s+)/);
    for (const token of tokens) {
      if (signal?.aborted) return;
      emit(token);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }

  private buildSystemPrompt(sessionType: SessionType, lengthMode: AnswerLengthMode, contextSummary: string, modifier: string | undefined): string {
    return `You are SideBro AI, an elite technical interview wingman assisting a candidate in a ${sessionType} technical interview.

ROLE & HUMAN SPEAKING DELIVERY:
You craft natural, spoken interview cues for a real candidate to say ALOUD to an interviewer.
- YOU ARE THE CANDIDATE SPEAKING DIRECTLY TO THE INTERVIEWER:
  • Speak directly in first-person ("I", "we", or direct technical statements).
  • ABSOLUTELY ZERO THIRD-PERSON META-TALK:
    - NEVER start with "The interviewer is asking about...", "The question asks...", "The interviewer wants to know...", or "The candidate should explain...".
    - The candidate will speak your answer word-for-word! If you say "The interviewer is asking...", the candidate sounds foolish!
    - Jump IMMEDIATELY into the direct technical answer:
      * WRONG: "The interviewer is asking about the call, apply, and bind methods in JavaScript, which are used to..."
      * RIGHT: "Call, apply, and bind in JavaScript are used to explicitly bind the this context of a function. I use call and apply for immediate execution, and bind when I need to return a new function for later callback execution."
  • Real engineers say: "The way I approach this is...", "In production, what I usually reach for is...", "The main trade-off we balance is...", "A classic gotcha you hit at scale is...".
  • NEVER give sterile dictionary definitions (e.g., do NOT say "Redis is an open-source in-memory data structure store...").
  • Focus on real production rationale: why an engineering team chooses it, how it actually behaves under load, and how you use it day-to-day.
  • NO robotic throat-clearing preambles: never say "Sure, I can explain that", "That's a great question", or "In conclusion".

FORMATTING & STYLING RULES (STRICT):
- DO NOT clutter the answer with markdown asterisks (**). Avoid double-asterisk spam.
- Write clean, conversational text without wrapping every title or phrase in asterisks (**). Keep it clean so it reads like human spoken notes on a teleprompter.

HUMAN SENIOR INTERVIEW ANSWERING FRAMEWORK:
1. Direct Spoken Lead:
   - 1-2 conversational sentences giving the bottom-line practical answer immediately from a senior engineer's viewpoint.
2. Under-the-Hood Mechanics:
   - Explain how the machinery actually works internally (data structures, execution loop, concurrency model, or protocols) in plain, articulate language.
3. Practical Trade-offs & Comparisons:
   - Talk about when you choose this vs alternatives (e.g., Redis vs Memcached, REST vs gRPC, SQL vs NoSQL, SSR vs CSR) and the practical engineering trade-offs (Latency vs Throughput, Consistency vs Availability, Memory vs CPU).
4. Production Gotchas & Edge Cases:
   - Share real battle scars: thundering herd/cache stampede, connection pool starvation, memory limits, race conditions, retry storms, or graceful degradation.

DOMAIN FOCUS:
The interview covers technical domains across:
1. Frontend: React, React Native, Next.js, Vue, TypeScript, JavaScript, Web Performance, SSR/SSG/ISR, State Management (Redux, Zustand), Virtual DOM, Hydration, Browser Rendering Pipeline, Event Loop, CSS/DOM optimization.
2. Backend & APIs: Node.js, NestJS, Express, Go, Python, Java, REST, GraphQL, gRPC, WebSockets, Event-Driven Architecture, Microservices, Authentication & Security (OAuth 2.0, JWT, RBAC).
3. Databases & Caching: PostgreSQL, MySQL, MongoDB, Redis, Cassandra, DynamoDB, ElasticSearch, ACID, Sharding, Replication, Indexing, Cache Invalidation, Distributed Locking.
4. Cloud, DevOps & Infrastructure: AWS (EC2, S3, Lambda), GCP, Azure, Docker, Kubernetes (K8s), Serverless, Terraform, CI/CD, Nginx, API Gateways, Message Brokers (Kafka, RabbitMQ, SQS, Pub/Sub).
5. System Design & Distributed Systems: Scalability, High Availability, Rate Limiting, Load Balancing, CAP Theorem, Fault Tolerance, Circuit Breakers, Consistent Hashing, Idempotency, Event Sourcing.

SPEECH-TO-TEXT MISTYPE & PHONETIC NORMALIZATION:
The incoming interviewer questions are transcribed in real-time from spoken audio and frequently suffer from speech-to-text (Whisper/WebSpeech) phonetic corruptions, misheard words, or rapid transcription typos.
- You MUST automatically detect any misheard, mistyped, or phonetically corrupted words and map them to their correct technical term from Frontend, Backend, Cloud, Databases, or System Design.
- Common phonetic STT misrecognitions you must normalize:
  • "red is" / "read is" / "rediss" ➔ Redis
  • "kates" / "k eight s" / "cooper nettys" / "cube netics" ➔ Kubernetes (K8s)
  • "neck js" / "next js" / "nextjs" ➔ Next.js
  • "recked" / "re act" ➔ React / React Native
  • "graph cool" / "graph ql" ➔ GraphQL
  • "post grass" / "post gres" ➔ PostgreSQL
  • "item potency" / "item potent" ➔ Idempotency / Idempotent
  • "o off" / "oath" / "oh auth" ➔ OAuth 2.0
  • "jott" / "j w t" ➔ JWT (JSON Web Token)
  • "engine x" / "n jinx" ➔ Nginx
  • "jee are peace" / "g r p c" ➔ gRPC
  • "see eye see dee" ➔ CI/CD
  • "darker" / "dock er" ➔ Docker
  • "see the end" ➔ CDN (Content Delivery Network)
  • "kaf ca" / "calf ca" ➔ Apache Kafka
  • "web sucket" / "web socket" ➔ WebSockets
  • "easy to" / "e c two" ➔ AWS EC2
  • "s three" ➔ AWS S3
  • "dynamo" / "dynamo db" ➔ DynamoDB
  • "terra form" ➔ Terraform
  • "promethius" ➔ Prometheus
  • "lamb da" ➔ AWS Lambda
- Understand the real technical question being asked, address the corrected technical concept, and answer with authoritative technical depth.

Candidate profile & context (the ONLY source for claims about the candidate's own experience):
${contextSummary || 'No profile provided.'}

Your task: deliver natural, human speaking points that the candidate can look at and verbalize smoothly in 60-90 seconds.
Answer length mode: ${lengthMode} (${lengthMode === 'quick' ? 'short, 2 punchy bullet points' : lengthMode === 'detailed' ? 'in-depth, low-level nuance, include code/config if relevant' : 'balanced, 3-4 bullet points'}).
${modifier ? `Special request: Make it ${modifier}.` : ''}

CRITICAL RULES:
1. Always directly answer the specific technical question asked (using the corrected technical concepts). Never output generic template answers.
2. NEVER invent personal experience, employers, projects, or metrics. Only reference experience that appears in the profile above. If the question asks about personal experience and the profile has nothing relevant, give a STAR outline with placeholders and tell the candidate to use a real example.
3. ONLY include a code block if the question asks for code, an algorithm, a data structure implementation, or programming syntax.
4. Format cleanly using standard markdown headers:
### Direct Answer
[1-2 clear, conversational sentences spoken naturally in first-person as an experienced engineer]

### Key Points
• [Core architectural mechanism and how it works under the hood, in plain spoken language]
• [Practical trade-offs, when you choose this vs alternatives]
• [Real-world production gotchas, scale challenges, or edge cases to watch out for]

### Code / Implementation Blueprint (ONLY if code was asked for)
\`\`\`[language]
// Working code or architectural definition
\`\`\`

### Anticipated Follow-up Questions
1. [Realistic follow-up question the interviewer is likely to ask next]
2. [Second realistic follow-up question]`;
  }

  private buildUserPrompt(questionText: string, recentTranscripts: { speaker: string; text: string }[]): string {
    return `Recent conversation context:
${recentTranscripts.slice(-4).map(t => `${t.speaker}: ${t.text}`).join('\n')}

Question: "${questionText}"
[CRITICAL INSTRUCTION: You are the candidate. Deliver the answer directly to the interviewer in first-person. NEVER start with "The interviewer is asking about..." or summarize the question. Jump straight into the direct technical answer with zero meta-commentary.]`;
  }

  /**
   * Reads a server-sent-events body line by line, buffering partial lines across chunks.
   */
  private async readSse(response: Response, onData: (data: string) => void): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No readable stream in provider response');
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) onData(trimmed.slice(5).trim());
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith('data:')) onData(tail.slice(5).trim());
  }

  /**
   * Stream from Google Gemini (SSE mode).
   */
  private async streamFromGemini(
    questionText: string,
    sessionType: SessionType,
    lengthMode: AnswerLengthMode,
    contextSummary: string,
    recentTranscripts: { speaker: string; text: string }[],
    modifier: string | undefined,
    emit: (token: string) => void,
    signal: AbortSignal
  ): Promise<void> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.geminiModel)}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.geminiApiKey as string,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: this.buildSystemPrompt(sessionType, lengthMode, contextSummary, modifier) }] },
          contents: [{ role: 'user', parts: [{ text: this.buildUserPrompt(questionText, recentTranscripts) }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: lengthMode === 'quick' ? 400 : 1100 },
        }),
        signal,
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API HTTP ${response.status}: ${await response.text()}`);
    }

    await this.readSse(response, data => {
      try {
        const parts = JSON.parse(data).candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.text && !part.thought) emit(part.text);
        }
      } catch {
        // ignore keep-alive or malformed lines
      }
    });
  }

  /**
   * Stream from Groq's OpenAI-compatible chat completions API.
   */
  private async streamFromGroq(
    questionText: string,
    sessionType: SessionType,
    lengthMode: AnswerLengthMode,
    contextSummary: string,
    recentTranscripts: { speaker: string; text: string }[],
    modifier: string | undefined,
    emit: (token: string) => void,
    signal: AbortSignal
  ): Promise<void> {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.groqModel,
        messages: [
          { role: 'system', content: this.buildSystemPrompt(sessionType, lengthMode, contextSummary, modifier) },
          { role: 'user', content: this.buildUserPrompt(questionText, recentTranscripts) },
        ],
        temperature: 0.3,
        max_tokens: lengthMode === 'quick' ? 400 : 1100,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Groq API HTTP ${response.status}: ${await response.text()}`);
    }

    const think = new ThinkFilter();
    await this.readSse(response, data => {
      if (data === '[DONE]') return;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) emit(think.push(delta));
      } catch {
        // ignore malformed lines
      }
    });
    emit(think.flush());
  }

  /**
   * Sanitizes direct answer to remove any third-person meta-commentary like "The interviewer is asking about..."
   */
  public sanitizeDirectAnswer(raw: string): string {
    if (!raw) return '';
    let cleaned = raw.trim();

    // Remove introductory meta clauses like:
    // "The interviewer is asking about...", "The question is asking about...", "The interviewer wants to know..."
    cleaned = cleaned.replace(/^(?:In this question,?\s*)?(?:The interviewer|The question|This question)\s+(?:is asking(?:\s+about|\s+how|\s+why)?|wants to know(?:\s+about)?|asks(?:\s+about)?)\s+(?:the\s+)?/i, '');

    // Convert relative clause: ", which is/are used to..." -> " is/are used to..."
    cleaned = cleaned.replace(/,\s+which\s+(is|are|was|were)\s+/i, ' $1 ');

    // Strip generic labels: "Here is the direct answer:" or "Direct Answer:"
    cleaned = cleaned.replace(/^(?:Here is (?:the )?(?:direct )?(?:answer|summary):?|Direct Answer:?)\s*/i, '');

    // Capitalize first character
    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
    return cleaned;
  }

  /**
   * Robust parser to extract direct answer, key points, code snippets, and follow-ups from model output
   */
  public parseStructuredSections(content: string): {
    directAnswer: string;
    keyPoints: string[];
    exampleOrSnippet?: string;
    followUpQuestions?: string[];
  } {
    // 1. Direct answer extraction
    let directAnswer = '';
    const directMatch = content.match(/### Direct Answer\s*\n([\s\S]*?)(?=\n###|$)/i);
    if (directMatch && directMatch[1].trim()) {
      directAnswer = this.sanitizeDirectAnswer(directMatch[1].trim());
    } else {
      const beforeHeaderMatch = content.match(/^([\s\S]*?)(?=\n###|\n```|$)/i);
      if (beforeHeaderMatch && beforeHeaderMatch[1].trim()) {
        const cleanLines = beforeHeaderMatch[1]
          .split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#') && !l.startsWith('•') && !l.startsWith('-') && !l.startsWith('*'));
        directAnswer = this.sanitizeDirectAnswer(cleanLines.slice(0, 2).join(' '));
      }
    }

    // 2. Key points extraction
    const keyPoints: string[] = [];
    const keyPointsMatch = content.match(/### Key Points\s*\n([\s\S]*?)(?=\n###|$)/i);
    const keyPointsBlock = keyPointsMatch ? keyPointsMatch[1] : '';

    if (keyPointsBlock) {
      const lines = keyPointsBlock.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
          const pt = trimmed.replace(/^[•\-\*]\s*/, '').trim();
          if (pt && !keyPoints.includes(pt)) {
            keyPoints.push(pt);
          }
        }
      }
    } else {
      const bulletRegex = /(?:^|\n)\s*[•\-\*]\s*([^\n]+)/g;
      let bMatch;
      while ((bMatch = bulletRegex.exec(content)) !== null) {
        const pt = bMatch[1].trim();
        if (pt && !pt.startsWith('#') && !keyPoints.includes(pt)) {
          keyPoints.push(pt);
        }
      }
    }

    // 3. Code snippet / implementation extraction (fenced code block or ### Code section)
    let exampleOrSnippet: string | undefined = undefined;
    const codeBlockMatch = content.match(/```(?:[a-zA-Z0-9_\-+]+)?\s*\n([\s\S]*?)```/);
    if (codeBlockMatch && codeBlockMatch[1].trim()) {
      exampleOrSnippet = codeBlockMatch[1].trim();
    } else {
      const codeSecMatch = content.match(/### (?:Code|Implementation|Architecture)[^\n]*\n([\s\S]*?)(?=\n###|$)/i);
      if (codeSecMatch && codeSecMatch[1].trim()) {
        exampleOrSnippet = codeSecMatch[1].trim();
      }
    }

    // 4. Follow-up questions extraction
    const followUpQuestions: string[] = [];
    const followUpMatch = content.match(/### (?:Anticipated )?Follow-up Questions\s*\n([\s\S]*?)(?=\n###|$)/i);
    if (followUpMatch && followUpMatch[1]) {
      const lines = followUpMatch[1].split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (/^(?:\d+[\.\)]|[•\-\*])\s*/.test(trimmed)) {
          const q = trimmed.replace(/^(?:\d+[\.\)]|[•\-\*])\s*/, '').trim();
          if (q && !followUpQuestions.includes(q)) {
            followUpQuestions.push(q);
          }
        }
      }
    }

    return {
      directAnswer,
      keyPoints,
      exampleOrSnippet,
      followUpQuestions,
    };
  }
}
