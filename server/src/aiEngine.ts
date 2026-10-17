import { AnswerLengthMode, AnswerSource, DetectedQuestion, GeneratedAnswer, SessionType } from './types.js';
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
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
/** Coding solutions carry full code plus explanation, so they get far more room than spoken answers. */
const CODING_MAX_TOKENS = 3000;

/** One user turn: text plus an optional base64 image (screenshots). */
interface ChatInput {
  text: string;
  image?: { base64: string; mimeType: string };
}

/** Input for a coding solution: copied text, or a screenshot of the candidate's screen. */
export type CodingInput =
  | { kind: 'text'; text: string }
  | { kind: 'image'; base64: string; mimeType: string };

interface ProviderRun {
  name: string;
  model: string;
  run: (sig: AbortSignal) => Promise<void>;
}

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
  private openaiApiKey: string | undefined;
  private groqModel: string;
  private geminiModel: string;
  private openaiModel: string;
  private openaiBaseUrl: string;
  private preferredProvider: string | undefined;
  private openaiVisionModel: string;
  private groqVisionModel: string | undefined;
  private preferredVisionProvider: string | undefined;
  private codingLanguage: string;

  constructor() {
    this.groqApiKey = process.env.GROQ_API_KEY;
    this.geminiApiKey = process.env.GEMINI_API_KEY;
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.groqModel = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
    this.geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    this.openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    this.openaiBaseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.preferredProvider = process.env.AI_PROVIDER?.toLowerCase();
    // Screenshots need a model that reads images. gpt-4o-mini and Gemini Flash both do; Groq only
    // with an explicitly configured vision model (the default Groq text model cannot see images).
    this.openaiVisionModel = process.env.OPENAI_VISION_MODEL || this.openaiModel;
    this.groqVisionModel = process.env.GROQ_VISION_MODEL || undefined;
    this.preferredVisionProvider = (process.env.VISION_PROVIDER || process.env.AI_PROVIDER)?.toLowerCase();
    this.codingLanguage = process.env.CODING_LANGUAGE || 'Go';
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
    const hasProvider = !!(this.groqApiKey || this.geminiApiKey || this.openaiApiKey || process.env.OPENAI_BASE_URL);

    // Initial default model name
    const defaultModel = this.groqApiKey
      ? `${this.groqModel} (Groq)`
      : this.openaiApiKey
      ? `${this.openaiModel} (OpenAI)`
      : this.geminiApiKey
      ? this.geminiModel
      : OFFLINE_MODEL;

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
      model: defaultModel,
      contextUsed: contextChunks.map(c => c.source),
      timestamp: Date.now(),
      source: question.source,
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

    const providers: (ProviderRun & { id: string })[] = [];
    if (this.groqApiKey) {
      providers.push({
        id: 'groq',
        name: 'Groq',
        model: `${this.groqModel} (Groq)`,
        run: sig => this.streamFromGroq(question.questionText, sessionType, lengthMode, contextSummary, recentTranscripts, actionModifier, emit, sig),
      });
    }
    if (this.openaiApiKey || process.env.OPENAI_BASE_URL) {
      providers.push({
        id: 'openai',
        name: this.openaiBaseUrl.includes('openai.com') ? 'OpenAI' : 'CustomLLM',
        model: `${this.openaiModel} (${this.openaiBaseUrl.includes('openai.com') ? 'OpenAI' : 'Custom'})`,
        run: sig => this.streamFromOpenAI(question.questionText, sessionType, lengthMode, contextSummary, recentTranscripts, actionModifier, emit, sig),
      });
    }
    if (this.geminiApiKey) {
      providers.push({
        id: 'gemini',
        name: 'Gemini',
        model: this.geminiModel,
        run: sig => this.streamFromGemini(question.questionText, sessionType, lengthMode, contextSummary, recentTranscripts, actionModifier, emit, sig),
      });
    }

    // Sort according to preferredProvider if specified (e.g. AI_PROVIDER=openai or AI_PROVIDER=gemini)
    if (this.preferredProvider) {
      providers.sort((a, b) => {
        if (a.id === this.preferredProvider) return -1;
        if (b.id === this.preferredProvider) return 1;
        return 0;
      });
    }

    const lastError = await this.runProviderChain(providers, answer, state, startTime, callbacks, signal);
    if (lastError === undefined) return;

    // Every configured provider failed before producing output.
    answer.model = OFFLINE_MODEL;
    const structured = this.generateStructuredResponse(
      question.questionText, question.type, sessionType, lengthMode, contextChunks, actionModifier
    );
    answer.directAnswer = structured.directAnswer;
    answer.keyPoints = structured.keyPoints;
    answer.exampleOrSnippet = structured.exampleOrSnippet;
    answer.followUpQuestions = structured.followUpQuestions;
    callbacks.onError(new Error(`AI provider unavailable (${(lastError as Error)?.message || 'unknown error'}); showing offline template.`));
    await this.simulateTokenStream(structured.fullContent, emit, signal);
    this.finish(answer, state, startTime, callbacks, false);
  }

  /**
   * Runs providers in order until one streams a full answer. Returns undefined when the answer was
   * finished (including partial output after an abort or a mid-stream failure), or the last error
   * when every provider failed before producing any output.
   */
  private async runProviderChain(
    providers: ProviderRun[],
    answer: GeneratedAnswer,
    state: StreamState,
    startTime: number,
    callbacks: AnswerStreamCallbacks,
    signal?: AbortSignal
  ): Promise<unknown> {
    let lastError: unknown = new Error('No AI provider configured');
    for (const provider of providers) {
      const sig = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)])
        : AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
      try {
        answer.model = provider.model;
        await provider.run(sig);
        this.finish(answer, state, startTime, callbacks, true);
        return undefined;
      } catch (err) {
        lastError = err ?? new Error('Unknown provider error');
        if (signal?.aborted) {
          // Superseded by a newer question: keep whatever was streamed so far.
          this.finish(answer, state, startTime, callbacks, true);
          return undefined;
        }
        if (state.emitted) {
          // Failed mid-stream. Falling back now would splice two different answers together.
          console.warn(`[AIEngine] ${provider.name} stream failed after output started:`, (err as Error)?.message);
          this.finish(answer, state, startTime, callbacks, true);
          callbacks.onError(new Error(`${provider.name} stream was interrupted; the answer may be incomplete.`));
          return undefined;
        }
        console.warn(`[AIEngine] ${provider.name} failed before output, trying next provider:`, (err as Error)?.message);
      }
    }
    return lastError;
  }

  /**
   * Streams a coding solution (pattern, approach, code, complexity) for copied text or a screenshot.
   * Uses its own prompt and token budget; screenshots go only to vision-capable providers.
   */
  public async streamCodingAnswer(
    question: DetectedQuestion,
    input: CodingInput,
    recentTranscripts: { speaker: string; text: string }[],
    callbacks: AnswerStreamCallbacks,
    preferredLanguage?: string,
    signal?: AbortSignal
  ): Promise<void> {
    const startTime = Date.now();
    const answer: GeneratedAnswer = {
      id: `ans-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      questionId: question.id,
      sessionId: question.sessionId,
      questionText: question.questionText,
      directAnswer: '',
      keyPoints: [],
      followUpQuestions: [],
      fullContent: '',
      isComplete: false,
      lengthMode: 'detailed',
      model: '',
      timestamp: Date.now(),
      source: question.source,
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

    const language = preferredLanguage || this.codingLanguage;
    const systemPrompt = this.buildCodingSystemPrompt(language);
    // Small models drift to Python unless the language rule is repeated next to the problem.
    const languageRule = `Write the code in ${language} unless the problem, starter code, or editor clearly uses another language.`;
    const conversation = recentTranscripts.slice(-4).map(t => `${t.speaker}: ${t.text}`).join('\n');
    const chatInput: ChatInput = input.kind === 'image'
      ? {
          text: `${conversation ? `Recent interview conversation:\n${conversation}\n\n` : ''}The attached image is a screenshot of the candidate's screen. Find the coding problem (and any code already written) and solve it. ${languageRule}`,
          image: { base64: input.base64, mimeType: input.mimeType },
        }
      : {
          text: `${conversation ? `Recent interview conversation:\n${conversation}\n\n` : ''}The candidate copied this text:\n\"\"\"\n${input.text}\n\"\"\"\n\n${languageRule}`,
        };
    const options = { temperature: 0.3, maxTokens: CODING_MAX_TOKENS };

    const providers: (ProviderRun & { id: string })[] = [];
    const openaiConfigured = !!(this.openaiApiKey || process.env.OPENAI_BASE_URL);
    const openaiName = this.openaiBaseUrl.includes('openai.com') ? 'OpenAI' : 'Custom';
    if (input.kind === 'image') {
      if (openaiConfigured) {
        providers.push({
          id: 'openai',
          name: openaiName,
          model: `${this.openaiVisionModel} (${openaiName})`,
          run: sig => this.streamChatCompletions(
            { label: 'OpenAI-compatible API', url: `${this.openaiBaseUrl}/chat/completions`, apiKey: this.openaiApiKey, model: this.openaiVisionModel },
            systemPrompt, chatInput, options, emit, sig
          ),
        });
      }
      if (this.geminiApiKey) {
        providers.push({
          id: 'gemini',
          name: 'Gemini',
          model: this.geminiModel,
          run: sig => this.streamGemini(this.geminiModel, systemPrompt, chatInput, options, emit, sig),
        });
      }
      if (this.groqApiKey && this.groqVisionModel) {
        const model = this.groqVisionModel;
        providers.push({
          id: 'groq',
          name: 'Groq',
          model: `${model} (Groq)`,
          run: sig => this.streamChatCompletions(
            { label: 'Groq API', url: GROQ_CHAT_URL, apiKey: this.groqApiKey, model },
            systemPrompt, chatInput, options, emit, sig
          ),
        });
      }
    } else {
      if (this.groqApiKey) {
        providers.push({
          id: 'groq',
          name: 'Groq',
          model: `${this.groqModel} (Groq)`,
          run: sig => this.streamChatCompletions(
            { label: 'Groq API', url: GROQ_CHAT_URL, apiKey: this.groqApiKey, model: this.groqModel },
            systemPrompt, chatInput, options, emit, sig
          ),
        });
      }
      if (openaiConfigured) {
        providers.push({
          id: 'openai',
          name: openaiName,
          model: `${this.openaiModel} (${openaiName})`,
          run: sig => this.streamChatCompletions(
            { label: 'OpenAI-compatible API', url: `${this.openaiBaseUrl}/chat/completions`, apiKey: this.openaiApiKey, model: this.openaiModel },
            systemPrompt, chatInput, options, emit, sig
          ),
        });
      }
      if (this.geminiApiKey) {
        providers.push({
          id: 'gemini',
          name: 'Gemini',
          model: this.geminiModel,
          run: sig => this.streamGemini(this.geminiModel, systemPrompt, chatInput, options, emit, sig),
        });
      }
    }

    const preferred = input.kind === 'image' ? this.preferredVisionProvider : this.preferredProvider;
    if (preferred) {
      providers.sort((a, b) => (a.id === preferred ? -1 : b.id === preferred ? 1 : 0));
    }

    answer.model = providers[0]?.model || OFFLINE_MODEL;
    callbacks.onStart(answer);
    const lastError = await this.runProviderChain(providers, answer, state, startTime, callbacks, signal);
    if (lastError === undefined) return;

    // Nothing was produced: show why in the panel instead of leaving it empty.
    answer.model = OFFLINE_MODEL;
    const reason = providers.length === 0
      ? input.kind === 'image'
        ? 'No vision-capable AI provider is configured. Set OPENAI_API_KEY or GEMINI_API_KEY (or GROQ_VISION_MODEL) to solve problems from screenshots.'
        : 'No AI provider is configured. Set GROQ_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY.'
      : `AI provider unavailable (${(lastError as Error)?.message || 'unknown error'}).`;
    emit(`### Direct Answer\n${reason}\n`);
    this.finish(answer, state, startTime, callbacks, true);
    callbacks.onError(new Error(reason));
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
      const direct = "At a high level, the big reason React introduced Fiber was to prevent UI lag. In earlier React, rendering was synchronous and recursive, so a big component tree could lock the main thread. Fiber breaks work into small, interruptible units so React can pause, let user clicks or typing through immediately, and resume without dropping frames.";
      const points = [
        "Pause and resume: It splits the tree into lightweight fiber units and yields back to the browser event loop whenever high-priority input like typing or animations comes in.",
        "Two-phase workflow: It does the heavy reconciliation asynchronously in the render phase where it can pause or discard work, and then commits actual DOM updates synchronously in one fast swipe.",
        "Priority scheduling: It uses lanes to ensure urgent keystrokes get handled right away, while deferring background data fetching or transitions.",
        "Double buffering: It keeps the current UI active on screen while quietly computing the next tree in memory, swapping root pointers as soon as it's ready."
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
        "How do React 18 transitions (useTransition) utilize Fiber lanes under the hood?",
        "What's the practical difference between the Render phase and Commit phase in daily debugging?",
        "How does Fiber handle error boundaries during reconciliation?"
      ];

      return this.formatAnswer(direct, points, snippet, followUps, lengthMode, modifier);
    }

    // 2. React Native Bridge vs JSI (JavaScript Interface)
    if (qLower.includes('jsi') || (qLower.includes('bridge') && qLower.includes('react native'))) {
      const direct = "The old React Native bridge had to serialize every single call into JSON and send it over an async message queue, which created noticeable stutter during fast gestures or animations. JSI fixes this by letting JavaScript hold direct C++ memory references, so JS can call native methods synchronously with zero JSON serialization overhead.";
      const points = [
        "Direct memory access: JavaScript engines like Hermes can access native C++ objects directly through HostObjects, completely eliminating the JSON serialization bottleneck.",
        "Synchronous when needed: For things that require instantaneous responses—like Bluetooth packets, crypto calculations, or gesture responders—you get immediate return values without async round trips.",
        "Foundation of the new architecture: Both TurboModules (lazy-loading native code on demand) and Fabric (direct native UI rendering) are built on top of JSI.",
        "Engine flexibility: Because JSI provides a clean abstraction layer, you can swap between Hermes, V8, or JavaScriptCore without changing your native binding code."
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
        "Why do TurboModules initialize so much faster than legacy NativeModules?",
        "How does Fabric use JSI to avoid layout thrashing across threads?",
        "What safety concerns should you watch out for when calling synchronous native functions via JSI?"
      ];

      return this.formatAnswer(direct, points, snippet, followUps, lengthMode, modifier);
    }

    // 3. Mobile list / rendering performance
    if (qLower.includes('flatlist') || (qLower.includes('performance') && (qLower.includes('react') || qLower.includes('mobile') || qLower.includes('list')))) {
      const direct = "When optimizing list or UI performance in React Native, the biggest wins usually come from list virtualization with view recycling, stopping unnecessary component re-renders, and getting heavy calculations off the JavaScript thread. I always profile first to target actual bottlenecks rather than guessing.";
      const points = [
        "Recycle native views: Using modern virtualized lists like FlashList reuses existing native cells rather than allocating and destroying views on rapid scroll.",
        "Tame re-renders: Keep state as local as possible, memoize expensive calculations with useMemo, and make sure stable callbacks don't cause cascading re-renders down the tree.",
        "Offload the JS thread: Move heavy data parsing, image transforms, or crypto over to background threads or native modules so the UI thread stays pinned at 60 FPS.",
        "Measure with real tools: Profile with React DevTools, Flipper, or platform profilers to inspect JS frame time and track where dropped frames actually happen."
      ];
      const snippet = `// Virtualized list configuration
<FlashList
  data={items}
  estimatedItemSize={88}
  renderItem={renderItem}
  keyExtractor={item => item.id}
/>`;
      const followUps = [
        "How do you profile memory leaks and image caches on iOS and Android?",
        "Which performance metrics do you track in production to monitor real-user experience?",
        "How do you keep nested scroll views smooth without gesture conflicts?"
      ];

      return this.formatAnswer(direct, points, snippet, followUps, lengthMode, modifier);
    }

    // 4. Behavioral STAR question: give structure, never invent the candidate's story
    if (category === 'Behavioral' || /\btell me about a time\b|\bdescribe a (situation|time)\b|\bbiggest challenge\b/.test(qLower)) {
      const ownNotes = context.find(c => c.source === 'projectNotes') || context[0];
      const direct = ownNotes
        ? `When answering this, speak naturally about a real project from your background. A great starting point from your profile: "${ownNotes.content.slice(0, 160)}${ownNotes.content.length > 160 ? '…' : ''}"`
        : "Walk through a real situation from your own experience. Keep the setup concise and focus most of your time on the concrete engineering decisions you personally drove.";
      const points = [
        "Set the scene quickly: One or two sentences on the team context, the problem, and why it was urgent or high-stakes.",
        "Your specific role: Clearly state what you personally owned versus what the rest of the team did.",
        "Concrete actions and trade-offs: Walk through the key technical decisions you made, the obstacles you ran into, and how you solved them.",
        "The impact and reflection: Share the measurable result, what shipped to users, and what you took away from the experience."
      ];
      const followUps = [
        "What would you do differently if you tackled that project again today?",
        "How did you keep stakeholders and cross-functional teams aligned during the process?",
        "What was the toughest engineering trade-off you had to defend?"
      ];

      return this.formatAnswer(direct, points, undefined, followUps, lengthMode, modifier);
    }

    // 5. Idempotency & Reliable API Design
    if (qLower.includes('idempot') || qLower.includes('retry') || qLower.includes('duplicate request')) {
      const direct = "At its core, idempotency is about making retries completely safe. If a client experiences a network timeout and fires the same payment or order request three times, an idempotent system guarantees the charge only executes once and returns the exact same successful result every time.";
      const points = [
        "Client idempotency key: The client generates a unique UUID with any mutating request and sends it in an Idempotency-Key header.",
        "Atomic distributed lock: When the request hits the gateway, we acquire a fast Redis lock on that key. If a duplicate retry arrives while the first request is still running, it holds or returns a 409 conflict.",
        "Cache the final response: Once the database transaction commits, we store the HTTP status code and response payload with a 24-hour TTL in Redis so duplicate retries return immediately without touching the database.",
        "Safe HTTP verb semantics: GET, PUT, and DELETE are naturally idempotent by HTTP spec; POST requires this explicit application-level idempotency key handling."
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
        "What is the difference between Idempotency and Deduplication in distributed messaging?",
        "How does the Transactional Outbox pattern support idempotent downstream events?"
      ];

      return this.formatAnswer(direct, points, snippet, followUps, lengthMode, modifier);
    }

    // 6. Distributed Rate Limiter
    if (qLower.includes('rate limit') || qLower.includes('throttl')) {
      const direct = "If I were designing a distributed rate limiter, I'd back our API gateways with a Redis cluster running a sliding window counter or token bucket so multiple gateway instances share an atomic count with sub-millisecond lookup overhead.";
      const points = [
        "Atomic sliding window in Redis: Running a small Lua script directly on Redis keeps the timestamp check and increment atomic, avoiding race conditions between gateway nodes.",
        "Fail-open resilience: If the Redis cluster ever degrades or becomes unreachable, the gateways fail open with local in-memory fallback limits so a rate limiter hiccup never takes down the API.",
        "Targeted client keys: For authenticated traffic, rate limit by user ID or account tier; for public unauthenticated endpoints, throttle by client IP and route.",
        "Standard rate limit headers: Always return standard headers like X-RateLimit-Remaining and Retry-After on 429 status codes so well-behaved clients can back off smoothly."
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
        "What are the practical trade-offs between Token Bucket vs Leaky Bucket vs Sliding Window Log?",
        "How would you implement tier-based rate limiting with dynamic subscription plans?"
      ];

      return this.formatAnswer(direct, points, snippet, followUps, lengthMode, modifier);
    }

    // 7. General System Design
    if (category === 'System Design' || qLower.includes('design a') || qLower.includes('scale') || qLower.includes('architect')) {
      const direct = `For designing ${questionText.replace(/\?$/, '')}, the way I usually approach this is starting with expected traffic patterns and data volume, then decoupling the read path and write path with caching and message queues so each layer can scale independently without single points of failure.`;
      const points = [
        "Decoupled edge and stateless services: Put Cloudflare CDN in front for cacheable assets, route through an API gateway for auth, and keep app services completely stateless so they auto-scale easily.",
        "Split read and write workloads: Put Redis in front of read replicas for high-frequency queries, and partition heavy write databases by tenant ID or consistent hashing.",
        "Asynchronous event queues: Offload non-blocking workflows like notifications or analytics into Kafka or RabbitMQ with dead-letter queues so user-facing endpoints stay snappy.",
        "Resilience and observability: Set up circuit breakers and distributed tracing with OpenTelemetry so when a third-party dependency degrades, the system degrades gracefully instead of cascading."
      ];
      const snippet = `// Conceptual Distributed System Gateway Architecture
// Client -> Anycast CDN -> API Gateway -> Envoy Service Mesh -> Microservices
// Write Path: Service -> Kafka Topic -> Consumer Worker -> Primary DB
// Read Path:  Service -> Redis Cluster (Cache-Aside) -> Read Replica DB`;
      const followUps = [
        "How do you handle data consistency across microservices (Saga pattern vs 2-phase commit)?",
        "How would you partition the database as throughput increases by 10x?",
        "What are your disaster recovery RPO and RTO targets for this system?"
      ];

      return this.formatAnswer(direct, points, snippet, followUps, lengthMode, modifier);
    }

    // 8. Coding question checklist
    if (category === 'Coding' || sessionType === 'coding' || /\b(algorithm|complexity|binary tree|linked list|dynamic programming|write a function|implement)\b/.test(qLower)) {
      const direct = `Offline mode doesn't generate live code for "${questionText.replace(/\?$/, '')}". Here is how to speak through the solution step-by-step with the interviewer.`;
      const points = [
        "Clarify first: Restate the problem in your own words, confirm input boundaries and constraints, and walk through a quick example out loud.",
        "State brute force: Mention the simple brute-force approach and its time/space complexity first—it shows you understand the baseline.",
        "Explain your optimization: Point out where repeated work can be avoided using a hash map, two pointers, sliding window, or memoization.",
        "Walk through test cases: Trace through the code with a normal input and highlight edge cases like null/empty arrays, duplicates, or extreme sizes."
      ];
      const followUps = [
        "Can you improve the time or space complexity further?",
        "How would this change if the input data did not fit in memory?",
        "Which unit test cases would you write to verify edge cases?"
      ];

      return this.formatAnswer(direct, points, undefined, followUps, lengthMode, modifier);
    }

    // 9. Generic / Fallback Technical Question
    const direct = `The way I'd talk through "${questionText.replace(/\?$/, '')}" in an interview is to break it down into the core motivation, practical production trade-offs, and what usually breaks at scale.`;
    const points = [
      `Start with the real-world goal: explain why a team adopts this pattern and what problem it solves in day-to-day engineering.`,
      "Highlight the trade-offs: contrast the pros and cons—like developer velocity vs complexity, or latency vs consistency.",
      "Production reliability: talk through how you monitor it with metrics, handle graceful degradation, and set up error boundaries.",
      "Edge cases and gotchas: point out common pitfalls or edge cases you've seen when scaling this up."
    ];
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
      finalPoints.push("Under the hood: Memory layout, cache locality, and atomic operations ensure high concurrency safety without locks.");
    } else if (modifier === 'alternative') {
      finalPoints.push("Alternative consideration: Contrast this with an asynchronous event queue (like Kafka or RabbitMQ) if the system needs eventual consistency and batch processing.");
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

NATURAL HUMAN CONVERSATIONAL TONE VS TEXTBOOK DEFINITIONS (TOP PRIORITY):
- Absolutely ZERO textbook, dictionary, or Wikipedia definitions.
  • Interviewers immediately tune out candidates who sound like they are reciting an encyclopedia or exam study guide.
  • WRONG (Textbook definition): "Redis is an open-source, in-memory data structure store used as a database, cache, message broker, and streaming engine that provides sub-millisecond response times..."
  • RIGHT (Human engineer): "The way I look at Redis in our stack is as our fast in-memory tier. We mostly reach for it for sub-millisecond caching, session tokens, or atomic locks to keep heavy repeat queries off our Postgres database."
  • WRONG (Textbook definition): "React Fiber is a reconciliation engine that maintains two trees to facilitate asynchronous rendering..."
  • RIGHT (Human engineer): "At a high level, the big reason React introduced Fiber was to prevent UI lag. In older React, rendering was synchronous and recursive, so a big component tree could lock the main thread. Fiber breaks work into small, interruptible units so React can pause, let user clicks or typing through immediately, and resume without dropping frames."
- SOUND LIKE AN EXPERIENCED COLLEAGUE DISCUSSING ARCHITECTURE OVER COFFEE:
  • Warm, confident, grounded, and conversational.
  • Jump into the Direct Answer with a natural conversational sentence:
    - "The way I usually approach this is..."
    - "At a high level, the core problem this solves is..."
    - "In production, what we usually reach for is..."
    - "The way I think about [Topic] is..."
  • Avoid stiff academic jargon ("delineates", "aforementioned", "sub-millisecond overhead guarantees", "paradigm shift"). Speak in clear, natural engineering English that feels authentic and spoken.
- "No textbook definitions" is about TONE, not about skipping the basics. The core facts an interviewer expects to hear must ALWAYS be stated explicitly.

ACRONYMS, NAMED LISTS & FUNDAMENTALS (OVERRIDES THE DEFAULT KEY POINTS STRUCTURE AND BULLET COUNT):
- If the question is about an acronym or a named set of items (SOLID, ACID, BASE, CAP, DRY, KISS, YAGNI, CRUD, REST constraints, OSI layers, 12-factor app, OOP pillars, HTTP methods, design pattern categories, React lifecycle phases, etc.), the candidate MUST name every item. Skipping or merging them is the most basic mistake an interviewer will notice.
  • Direct Answer: say what the acronym stands for in one breath, e.g. "SOLID is five object-oriented design principles: Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, and Dependency Inversion."
  • Key Points: exactly ONE bullet per item, in order, starting with the letter or name followed by a short spoken explanation and a tiny concrete example, e.g. "• S — Single Responsibility: a class should have one reason to change, so my UserService doesn't also send emails; that lives in a NotificationService."
  • NEVER combine two items in one bullet. Keep each bullet to 1-2 short sentences so all items fit.
  • Optionally add one final bullet on how you apply it in practice or where over-applying it hurts.
- For other fundamental "What is X?" questions, the Direct Answer must still state plainly what X is (conversationally) before moving to how it works and trade-offs.

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
  • Focus on real production rationale: why an engineering team chooses it, how it actually behaves under load, and how you use it day-to-day.
  • NO robotic throat-clearing preambles: never say "Sure, I can explain that", "That's a great question", or "In conclusion".

FORMATTING & STYLING RULES (STRICT):
- DO NOT clutter the answer with markdown asterisks (**). Avoid double-asterisk spam.
- In Key Points, NEVER use bold concept headers like "**Definition**:", "**Architecture**:", "**Trade-off Analysis**:", or "**Mechanisms**:".
- Each bullet point must be a clean spoken talking point that flows naturally when read aloud:
  * WRONG: "• **Interruptible Rendering**: Divides rendering work into small units (fibers) that yield..."
  * RIGHT: "• It pauses and resumes: instead of locking the thread with one giant pass, it yields back to the browser event loop whenever high-priority user interactions come in."
  * WRONG: "• **Trade-off Analysis**: Balance time complexity vs space complexity..."
  * RIGHT: "• On trade-offs: you're trading memory for latency here—caching precomputed aggregates in memory saves heavy SQL joins at the expense of cache invalidation complexity."
- Write clean, conversational text that reads like human spoken notes on a teleprompter.

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
  • "mongo tv" / "mongolipi" / "mongo d b" / "mango db" ➔ MongoDB
  • "to eat" / "the leet" / "d leet" (after "cascading", "soft", "hard") ➔ delete
  • "my sequel" / "my s q l" ➔ MySQL
  • "no sequel" ➔ NoSQL
  • "type script" / "tight script" ➔ TypeScript
  • "use effect" / "use memo" / "use call back" ➔ useEffect / useMemo / useCallback
- Understand the real technical question being asked, address the corrected technical concept, and answer with authoritative technical depth.

INTERPRETING NOISY QUESTIONS (MANDATORY):
This is a live technical interview, so every question is about software engineering. Garbled words are always a transcription artifact, never a real non-technical topic.
- Decode garbled words by sound and by context: the surrounding real words, the recent conversation, and the candidate profile. E.g. "how you will implement the cascading to eat in mongolipi" ➔ "How would you implement cascading deletes in MongoDB?".
- COMMIT to the single most likely technical interpretation and answer it fully and confidently, as if it had been transcribed perfectly.
- NEVER mention transcription, audio, mishearing, typos, or that the question is unclear. NEVER say "I suspect", "did you mean", "if you meant", or "could you clarify".
- NEVER ask the interviewer to clarify and NEVER split the answer across multiple possible interpretations. The candidate reads your answer aloud; hedging makes them sound like they did not understand the question.
- Only if the text is truly undecodable, answer the closest technical topic that the recognizable words point to.

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
(For acronyms / named lists: one bullet per item instead, as described above.)
• [First spoken talking point on how it works under the hood, in plain conversational language]
• [Second spoken talking point on practical trade-offs when choosing this vs alternatives]
• [Third spoken talking point on real-world production gotchas or edge cases to watch out for]

### Code / Implementation Blueprint (ONLY if code was asked for)
\`\`\`[language]
// Working code or architectural definition
\`\`\`

### Anticipated Follow-up Questions
1. [Realistic follow-up question the interviewer is likely to ask next]
2. [Second realistic follow-up question]`;
  }

  private buildCodingSystemPrompt(defaultLanguage: string): string {
    return `You are SideBro AI, helping a candidate in a live coding interview. You receive either text the candidate copied (often a problem the interviewer pasted in the meeting chat) or a screenshot of the candidate's screen.

FIRST, WORK OUT WHAT IS BEING ASKED:
- A problem statement: solve it.
- A problem plus code the candidate already wrote (possibly incomplete or buggy): complete or fix THEIR code, keeping their structure, names, and function signature.
- Code with no problem statement: explain what it does, point out bugs or edge cases it misses, and give a corrected version.
- A screenshot: ignore unrelated UI (browser chrome, video tiles, docks, notifications, chat names). Read the problem statement, examples, constraints, and any starter code carefully.
- If the input is clearly not about code at all, say so in one line under Direct Answer and stop.

LANGUAGE:
- If the problem, starter code, or editor shows a language, use exactly that language and the given signature.
- Otherwise write the solution in ${defaultLanguage}.

QUALITY RULES:
- The code must be complete, correct, and runnable for the stated constraints. Prefer the optimal approach the interviewer expects.
- Keep explanations short, plain, and spoken: the candidate should be able to say them aloud while coding.
- No preambles ("Sure", "Great question"). No meta-talk about the screenshot or the candidate.

FORMAT EXACTLY WITH THESE MARKDOWN HEADERS:
### Direct Answer
[1-2 sentences: what the problem asks and the key insight / pattern, e.g. "Sliding window over the string, tracking the last index of each character."]

### Key Points
• Pattern: [name of the pattern, e.g. Two Pointers, Sliding Window, BFS, DP, Heap, Union-Find, Binary Search on answer]
• Brute force: [idea in one line, with its complexity]
• Optimal: [step 1 of the approach, in plain words]
• [step 2, and further steps as needed]
• Edge cases: [empty input, duplicates, negatives, overflow, ...]

### Code / Implementation Blueprint
\`\`\`[language]
[full solution with brief comments on the key lines]
\`\`\`

### Complexity
• Time: O(...) because ...
• Space: O(...) because ...

### Dry Run
[Walk one small example through the code in 3-5 short lines.]

### Anticipated Follow-up Questions
1. [A likely follow-up, e.g. a variant or constraint change, with a one-line hint]
2. [Second follow-up with a one-line hint]`;
  }

  private buildUserPrompt(questionText: string, recentTranscripts: { speaker: string; text: string }[]): string {
    return `Recent conversation context:
${recentTranscripts.slice(-4).map(t => `${t.speaker}: ${t.text}`).join('\n')}

Question (raw live speech-to-text; may contain misheard words): "${questionText}"
[CRITICAL INSTRUCTION: You are the candidate speaking aloud in the interview. Silently decode any misheard words into the most likely technical interview question, then answer THAT question directly to the interviewer in first-person.
Speak in a natural, human conversational tone like an experienced senior engineer—zero textbook definitions, zero robotic labels, and zero third-person commentary. Jump straight into the direct answer.]`;
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
    await this.streamGemini(
      this.geminiModel,
      this.buildSystemPrompt(sessionType, lengthMode, contextSummary, modifier),
      { text: this.buildUserPrompt(questionText, recentTranscripts) },
      { temperature: 0.65, maxTokens: lengthMode === 'quick' ? 400 : 1100 },
      emit,
      signal
    );
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
    await this.streamChatCompletions(
      { label: 'Groq API', url: GROQ_CHAT_URL, apiKey: this.groqApiKey, model: this.groqModel },
      this.buildSystemPrompt(sessionType, lengthMode, contextSummary, modifier),
      { text: this.buildUserPrompt(questionText, recentTranscripts) },
      { temperature: 0.65, maxTokens: lengthMode === 'quick' ? 300 : lengthMode === 'detailed' ? 850 : 550 },
      emit,
      signal
    );
  }

  /**
   * Stream from OpenAI or any OpenAI-compatible API (Ollama, DeepSeek, OpenRouter, Together AI).
   */
  private async streamFromOpenAI(
    questionText: string,
    sessionType: SessionType,
    lengthMode: AnswerLengthMode,
    contextSummary: string,
    recentTranscripts: { speaker: string; text: string }[],
    modifier: string | undefined,
    emit: (token: string) => void,
    signal: AbortSignal
  ): Promise<void> {
    await this.streamChatCompletions(
      { label: 'OpenAI-compatible API', url: `${this.openaiBaseUrl}/chat/completions`, apiKey: this.openaiApiKey, model: this.openaiModel },
      this.buildSystemPrompt(sessionType, lengthMode, contextSummary, modifier),
      { text: this.buildUserPrompt(questionText, recentTranscripts) },
      { temperature: 0.65, maxTokens: lengthMode === 'quick' ? 300 : lengthMode === 'detailed' ? 850 : 550 },
      emit,
      signal
    );
  }

  /**
   * Streams one chat completion from Gemini. An attached image is sent inline.
   */
  private async streamGemini(
    model: string,
    systemPrompt: string,
    input: ChatInput,
    options: { temperature: number; maxTokens: number },
    emit: (token: string) => void,
    signal: AbortSignal
  ): Promise<void> {
    const parts: any[] = [{ text: input.text }];
    if (input.image) parts.push({ inlineData: { mimeType: input.image.mimeType, data: input.image.base64 } });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.geminiApiKey as string,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: options.temperature, maxOutputTokens: options.maxTokens },
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
   * Streams one chat completion from an OpenAI-compatible endpoint (OpenAI, Groq, Ollama, ...).
   * An attached image is sent as an image_url content part.
   */
  private async streamChatCompletions(
    endpoint: { label: string; url: string; apiKey: string | undefined; model: string },
    systemPrompt: string,
    input: ChatInput,
    options: { temperature: number; maxTokens: number },
    emit: (token: string) => void,
    signal: AbortSignal
  ): Promise<void> {
    const userContent = input.image
      ? [
          { type: 'text', text: input.text },
          { type: 'image_url', image_url: { url: `data:${input.image.mimeType};base64,${input.image.base64}` } },
        ]
      : input.text;

    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${endpoint.apiKey || 'not-needed'}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: endpoint.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`${endpoint.label} HTTP ${response.status}: ${await response.text()}`);
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
