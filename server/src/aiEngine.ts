import { AnswerLengthMode, DetectedQuestion, GeneratedAnswer, SessionType } from './types.js';
import { DocumentChunk } from './contextEngine.js';

export interface AnswerStreamCallbacks {
  onStart: (answer: GeneratedAnswer) => void;
  onToken: (token: string, accumulated: string) => void;
  onComplete: (answer: GeneratedAnswer) => void;
  onError: (err: any) => void;
}

import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

export class AIEngine {
  private groqApiKey: string | undefined;
  private geminiApiKey: string | undefined;
  private openaiApiKey: string | undefined;

  constructor() {
    this.groqApiKey = process.env.GROQ_API_KEY;
    this.geminiApiKey = process.env.GEMINI_API_KEY;
    this.openaiApiKey = process.env.OPENAI_API_KEY;
  }

  public setApiKey(provider: 'groq' | 'gemini' | 'openai', key: string): void {
    if (provider === 'groq') this.groqApiKey = key;
    if (provider === 'gemini') this.geminiApiKey = key;
    if (provider === 'openai') this.openaiApiKey = key;
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
    actionModifier?: 'shorter' | 'expand' | 'example' | 'technical_detail' | 'star' | 'alternative'
  ): Promise<void> {
    const startTime = Date.now();

    const answerId = `ans-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const contextSummary = contextChunks.map(c => `[${c.source.toUpperCase()}]: ${c.content}`).join('\n\n');

    // Build initial placeholder answer
    const structuredResponse = this.generateStructuredResponse(
      question.questionText,
      question.type,
      sessionType,
      lengthMode,
      contextChunks,
      actionModifier
    );

    const initialAnswer: GeneratedAnswer = {
      id: answerId,
      questionId: question.id,
      sessionId: question.sessionId,
      questionText: question.questionText,
      directAnswer: structuredResponse.directAnswer,
      keyPoints: structuredResponse.keyPoints,
      exampleOrSnippet: (this.groqApiKey || this.geminiApiKey) ? undefined : structuredResponse.exampleOrSnippet,
      followUpQuestions: structuredResponse.followUpQuestions,
      fullContent: '',
      isComplete: false,
      lengthMode,
      model: this.groqApiKey ? 'qwen/qwen3.8-27b (Groq)' : this.geminiApiKey ? 'gemini-2.0-flash' : 'sidebro-expert-engine',
      contextUsed: contextChunks.map(c => c.source),
      timestamp: Date.now(),
    };

    callbacks.onStart(initialAnswer);

    // 1. Primary: Ultra-fast Groq streaming (<250ms latency)
    if (this.groqApiKey) {
      try {
        await this.streamFromGroq(
          question.questionText,
          sessionType,
          lengthMode,
          contextSummary,
          recentTranscripts,
          actionModifier,
          callbacks,
          initialAnswer,
          startTime
        );
        return;
      } catch (err) {
        console.warn('[AIEngine] Groq stream failed, falling back to next provider:', err);
      }
    }

    // 2. Secondary: Gemini API stream if configured
    if (this.geminiApiKey) {
      try {
        await this.streamFromGemini(
          question.questionText,
          sessionType,
          lengthMode,
          contextSummary,
          recentTranscripts,
          actionModifier,
          callbacks,
          initialAnswer,
          startTime
        );
        return;
      } catch (err) {
        console.warn('[AIEngine] Gemini API stream failed, falling back to built-in expert engine:', err);
      }
    }

    // 3. Fallback: High-fidelity token-by-token streaming
    await this.simulateTokenStream(
      structuredResponse.fullContent,
      callbacks,
      initialAnswer,
      startTime
    );
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

    // 3. Performance Improvement / FlatList / Mobile Optimization
    if (qLower.includes('performance') || qLower.includes('flatlist') || qLower.includes('improved')) {
      const direct = "I improved application performance by 42% through migrating list virtualization to FlashList/recycling, eliminating bridge serialization bottlenecks with JSI, and optimizing the React render tree with memoization and Web Workers.";
      const points = [
        "**View Recycling**: Replaced FlatList with recycling architecture (FlashList/Shopify), reusing native cell views rather than creating/destroying view nodes during rapid scroll.",
        "**Heavy Compute Offloading**: Offloaded large JSON data transformations and image hashing into background C++ threads via JSI / Web Workers.",
        "**Render Optimization**: Implemented strict React.memo, stable callbacks (`useCallback`), and split state into atomic stores (Zustand) to stop cascade re-renders.",
        "**Hermes Bytecode**: Precompiled JavaScript to Hermes bytecode at build time, shrinking TTI (Time to Interactive) by 45% and memory by 35MB."
      ];
      const snippet = `// High-performance virtualization configuration
<FlashList
  data={heavyFeedItems}
  estimatedItemSize={88}
  renderItem={renderFeedItem}
  keyExtractor={item => item.id}
  removeClippedSubviews={true}
  maxToRenderPerBatch={10}
  windowSize={5}
/>`;
      const followUps = [
        "How do you profile memory leaks using Xcode Instruments and Android Studio Profiler?",
        "What metrics (e.g. FPS, JS Frame Time, TTI) do you track in production APM?",
        "How do you handle complex nested scroll views without dropping 60 FPS?"
      ];

      return this.formatAnswer(direct, points, snippet, followUps, lengthMode, modifier);
    }

    // 4. Behavioral STAR Question (Conflict, Production Incident, Challenge)
    if (category === 'Behavioral' || qLower.includes('time') || qLower.includes('challenge') || qLower.includes('incident')) {
      const direct = "During a Black Friday traffic surge, our primary Redis cluster hit 98% memory capacity causing a cache-stampede incident. I led the incident response, mitigated the stampede within 18 minutes, and re-architected our caching layer.";
      const points = [
        "**Situation (S)**: Black Friday peak traffic caused sudden Redis eviction of top catalog keys, triggering thousands of concurrent database fallbacks and DB connection exhaustion.",
        "**Task (T)**: As the incident commander, I needed to stabilize the primary database, stop the cache stampede, and restore customer checkout SLA.",
        "**Action (A)**: Implemented probabilistic early expiration (XFetch algorithm) in our application gateway and added distributed mutex locking (Redlock) so only 1 worker refreshed cold keys.",
        "**Result (R)**: Stabilized DB CPU from 99% to 22% within 18 minutes. Subsequent load tests showed zero downtime at 3.5x regular peak throughput."
      ];
      const snippet = `// STAR Takeaways:
// 1. Quick triage & clear blameless incident communications.
// 2. Resilience patterns: Circuit breaker, XFetch early cache refresh, Redlock.
// 3. Post-mortem root cause analysis and automated synthetic monitoring.`;
      const followUps = [
        "How did you coordinate cross-team communication during the live outage?",
        "What safeguards did you put in place to prevent future cache stampedes?",
        "What was the biggest lesson you learned from that incident?"
      ];

      return this.formatAnswer(direct, points, snippet, followUps, lengthMode, modifier);
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

    // 6. Coding Mode (PRD Section 39: Approach, Algorithm, Complexity, Code, Edge Cases)
    if (category === 'Coding' || sessionType === 'coding' || qLower.includes('algorithm') || qLower.includes('complexity') || qLower.includes('binary tree') || qLower.includes('linked list') || qLower.includes('function') || qLower.includes('dynamic programming')) {
      const direct = `For "${questionText.replace(/\?$/, '')}", the optimal algorithmic approach achieves O(N) time complexity and O(1) auxiliary space using two-pointer / hash-map tracking.`;
      const points = [
        "**Approach (PRD §39)**: Use a sliding window or two-pointer scan to avoid redundant nested iterations, maintaining state in a fast lookup hash table.",
        "**Algorithm**: 1. Initialize left and right pointers. 2. Expand right pointer to incorporate current element into frequency map. 3. While condition violated, contract left pointer. 4. Update max length / result.",
        "**Complexity**: **Time Complexity**: O(N) single-pass traversal • **Space Complexity**: O(K) where K is character set size.",
        "**Edge Cases**: Null or empty input, single-element collections, duplicate elements, and integer overflow boundary checks."
      ];
      const snippet = `// Optimal O(N) TypeScript Implementation
export function solveProblem(input: string[] | number[]): number {
  if (!input || input.length === 0) return 0;
  
  const seen = new Map<number, number>();
  let maxResult = 0;
  let left = 0;
  
  for (let right = 0; right < input.length; right++) {
    const val = input[right] as number;
    if (seen.has(val) && seen.get(val)! >= left) {
      left = seen.get(val)! + 1; // Slide window past duplicate
    }
    seen.set(val, right);
    maxResult = Math.max(maxResult, right - left + 1);
  }
  
  return maxResult;
}`;
      const followUps = [
        "What are the space-time trade-offs if we cannot use extra memory O(1)?",
        "How would you handle streaming data where total size does not fit into RAM?",
        "What unit tests would you write for boundary and negative edge cases?"
      ];

      return this.formatAnswer(direct, points, snippet, followUps, lengthMode, modifier);
    }

    // 7. Generic / Fallback Technical Question
    const direct = `To address "${questionText.replace(/\?$/, '')}", the optimal engineering approach balances architectural clarity, modular decoupling, and observable reliability in production.`;
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
      followUps.forEach(f => {
        fullMarkdown += `1. ${f}\n`;
      });
    }

    return {
      directAnswer: finalDirect,
      keyPoints: finalPoints,
      exampleOrSnippet: finalSnippet,
      followUpQuestions: followUps,
      fullContent: fullMarkdown,
    };
  }

  /**
   * Simulates realistic token-by-token streaming (40ms chunks) for sub-second first-token response
   */
  private async simulateTokenStream(
    fullContent: string,
    callbacks: AnswerStreamCallbacks,
    initialAnswer: GeneratedAnswer,
    startTime: number
  ): Promise<void> {
    const tokens = fullContent.split(/(\s+)/);
    let accumulated = '';
    let isFirst = true;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      accumulated += token;

      if (isFirst) {
        initialAnswer.firstTokenLatencyMs = Date.now() - startTime;
        isFirst = false;
      }

      callbacks.onToken(token, accumulated);

      // Pace tokens between 15ms and 35ms for natural reading speed
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    initialAnswer.fullContent = accumulated;
    initialAnswer.isComplete = true;
    initialAnswer.totalLatencyMs = Date.now() - startTime;
    callbacks.onComplete(initialAnswer);
  }

  /**
   * Stream directly from Google Gemini API
   */
  private async streamFromGemini(
    questionText: string,
    sessionType: SessionType,
    lengthMode: AnswerLengthMode,
    contextSummary: string,
    recentTranscripts: { speaker: string; text: string }[],
    modifier: string | undefined,
    callbacks: AnswerStreamCallbacks,
    initialAnswer: GeneratedAnswer,
    startTime: number
  ): Promise<void> {
    const prompt = `
You are SideBro AI, a world-class real-time AI conversation wingman helping a candidate in a ${sessionType} interview.
The interviewer just asked: "${questionText}".

Uploaded Candidate Context:
${contextSummary || 'No extra documents provided.'}

Recent Conversation:
${recentTranscripts.slice(-4).map(t => `${t.speaker}: ${t.text}`).join('\n')}

Requirement:
Answer length mode: ${lengthMode}.
${modifier ? `Special request: Make it ${modifier}.` : ''}

Format your response cleanly:
### Direct Answer
[1-2 punchy sentences that give the core insight immediately]

### Key Points
• [Bullet 1 with **bold keywords**]
• [Bullet 2 with **bold keywords**]
• [Bullet 3 with **bold keywords**]

### Code / Implementation Blueprint (Include when technical, coding, or architecture problem)
\`\`\`typescript
// Working, complete, production-grade code or snippet
\`\`\`

### Anticipated Follow-up Questions
1. [Follow up 1]
2. [Follow up 2]
    `.trim();

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?key=${this.geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API HTTP ${response.status}: ${await response.text()}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No readable stream from Gemini API');

    const decoder = new TextDecoder();
    let accumulated = '';
    let isFirst = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      // Parse SSE JSON
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ') || line.trim().startsWith('{')) {
          const jsonStr = line.startsWith('data: ') ? line.slice(6) : line;
          try {
            const data = JSON.parse(jsonStr);
            const candidate = data.candidates?.[0];
            const textPart = candidate?.content?.parts?.[0]?.text;
            if (textPart) {
              if (isFirst) {
                initialAnswer.firstTokenLatencyMs = Date.now() - startTime;
                isFirst = false;
              }
              accumulated += textPart;
              callbacks.onToken(textPart, accumulated);
            }
          } catch {
            // Partial JSON buffer, proceed
          }
        }
      }
    }

    const parsed = this.parseStructuredSections(accumulated);
    if (parsed.directAnswer) initialAnswer.directAnswer = parsed.directAnswer;
    if (parsed.keyPoints && parsed.keyPoints.length > 0) initialAnswer.keyPoints = parsed.keyPoints;
    initialAnswer.exampleOrSnippet = parsed.exampleOrSnippet || undefined;
    if (parsed.followUpQuestions && parsed.followUpQuestions.length > 0) initialAnswer.followUpQuestions = parsed.followUpQuestions;

    initialAnswer.fullContent = accumulated;
    initialAnswer.isComplete = true;
    initialAnswer.totalLatencyMs = Date.now() - startTime;
    callbacks.onComplete(initialAnswer);
  }

  /**
   * Stream directly from Groq using qwen/qwen3.8-27b (ultra-fast sub-second LLM)
   */
  private async streamFromGroq(
    questionText: string,
    sessionType: SessionType,
    lengthMode: AnswerLengthMode,
    contextSummary: string,
    recentTranscripts: { speaker: string; text: string }[],
    modifier: string | undefined,
    callbacks: AnswerStreamCallbacks,
    initialAnswer: GeneratedAnswer,
    startTime: number
  ): Promise<void> {
    const systemPrompt = `You are SideBro AI, a world-class real-time AI conversation wingman and expert copilot helping a candidate in a ${sessionType} interview.
Candidate Profile & Context:
${contextSummary || 'Senior Software Engineer with deep fullstack, mobile, and distributed systems experience.'}

Your task: Provide immediate, high-impact, authentic speaking points for the candidate.
Answer length mode: ${lengthMode} (${lengthMode === 'quick' ? 'short, 2 punchy bullet points' : lengthMode === 'detailed' ? 'in-depth, low-level nuance, include code/config if relevant' : 'balanced, 3-4 bullet points'}).
${modifier ? `Special request: Make it ${modifier}.` : ''}

CRITICAL RULES:
1. Always directly answer the specific question asked. Never output generic template answers.
2. ONLY include a Code block if the question explicitly asks for code, writing an algorithm, data structure implementation, or programming syntax.
3. If the question is conceptual, behavioral, architectural, or conversational (e.g. system design trade-offs, team experience, or conceptual explanations like Node.js event loop), DO NOT include any code block. Only provide Direct Answer, Key Points, and Follow-up Questions.
4. Format cleanly using standard markdown headers:
### Direct Answer
[1-2 clear, punchy sentences giving the core insight directly]

### Key Points
• [Core architectural insight, mechanism, or metric with **bold terms**]
• [Trade-off, operational experience, or implementation detail]
• [Production nuance, scalability, or edge-case handling]

### Code / Implementation Blueprint (ONLY if code/algorithm implementation was asked for)
\`\`\`[language]
// Working, production-grade code or implementation snippet
\`\`\`

### Anticipated Follow-up Questions
1. [Realistic follow-up question the interviewer might ask next]
2. [Second realistic follow-up question]`;

    const userContent = `Recent conversation:
${recentTranscripts.slice(-4).map(t => `${t.speaker}: ${t.text}`).join('\n')}

Interviewer Question: "${questionText}"
Provide the winning answer now:`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.8-27b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.3,
        max_tokens: lengthMode === 'quick' ? 400 : 1100,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API HTTP ${response.status}: ${await response.text()}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No readable stream from Groq API');

    const decoder = new TextDecoder();
    let accumulated = '';
    let isFirst = true;
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            const delta = data.choices?.[0]?.delta?.content;
            if (delta) {
              if (isFirst) {
                initialAnswer.firstTokenLatencyMs = Date.now() - startTime;
                isFirst = false;
              }
              accumulated += delta;
              callbacks.onToken(delta, accumulated);
            }
          } catch {}
        }
      }
    }

    // Extract structured sections from accumulated LLM response
    const parsed = this.parseStructuredSections(accumulated);
    if (parsed.directAnswer) initialAnswer.directAnswer = parsed.directAnswer;
    if (parsed.keyPoints && parsed.keyPoints.length > 0) initialAnswer.keyPoints = parsed.keyPoints;
    initialAnswer.exampleOrSnippet = parsed.exampleOrSnippet || undefined;
    if (parsed.followUpQuestions && parsed.followUpQuestions.length > 0) initialAnswer.followUpQuestions = parsed.followUpQuestions;

    initialAnswer.fullContent = accumulated;
    initialAnswer.isComplete = true;
    initialAnswer.totalLatencyMs = Date.now() - startTime;
    callbacks.onComplete(initialAnswer);
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
      directAnswer = directMatch[1].trim();
    } else {
      const beforeHeaderMatch = content.match(/^([\s\S]*?)(?=\n###|\n```|$)/i);
      if (beforeHeaderMatch && beforeHeaderMatch[1].trim()) {
        const cleanLines = beforeHeaderMatch[1]
          .split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#') && !l.startsWith('•') && !l.startsWith('-') && !l.startsWith('*'));
        directAnswer = cleanLines.slice(0, 2).join(' ');
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
