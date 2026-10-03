import { DetectedQuestion, QuestionCategory, TranscriptItem } from './types.js';

interface QuestionBuffer {
  sessionId: string;
  transcriptIds: string[];
  chunks: string[];
  timer: NodeJS.Timeout | null;
  lastSpeaker: 'YOU' | 'OTHER';
  incompleteRetries: number;
}

export class QuestionDetector {
  private buffers: Map<string, QuestionBuffer> = new Map();
  private readonly BUFFER_DEBOUNCE_MS = 3200; // 3.2s debounce allows natural pauses and multi-slice sentence completion
  private onQuestionDetected: (question: DetectedQuestion) => void;

  constructor(onQuestionDetected: (question: DetectedQuestion) => void) {
    this.onQuestionDetected = onQuestionDetected;
  }

  /**
   * Ingests a new transcript chunk and processes question buffering
   */
  public ingestTranscript(transcript: TranscriptItem): void {
    // Only detect questions asked by OTHER speaker or explicit questions
    const text = transcript.text.trim();
    if (!text || text.length < 2) return;
    if (/^[\s\.\,\?\!\-\_\:\;\'\"…]+$/.test(text)) return;
    if (/^(thank\s*you|thanks|okay|bye|the\s*end)[\s.!,]*$/i.test(text)) return;

    const sessionId = transcript.sessionId;
    let buf = this.buffers.get(sessionId);

    if (!buf) {
      buf = {
        sessionId,
        transcriptIds: [],
        chunks: [],
        timer: null,
        lastSpeaker: transcript.speaker,
        incompleteRetries: 0,
      };
      this.buffers.set(sessionId, buf);
    }

    // If speaker changes and we have a pending buffer, evaluate immediately
    if (buf.lastSpeaker !== transcript.speaker && buf.chunks.length > 0) {
      if (buf.timer) clearTimeout(buf.timer);
      this.evaluateBuffer(sessionId);
    }

    buf.lastSpeaker = transcript.speaker;
    buf.chunks.push(text);
    buf.transcriptIds.push(transcript.id);
    buf.incompleteRetries = 0; // Reset retries on new speech chunk

    // Reset buffer timer
    if (buf.timer) {
      clearTimeout(buf.timer);
    }

    // If the chunk explicitly ends with a question mark and is grammatically complete, evaluate slightly faster
    const isPunctuationQuestion = text.endsWith('?') && text.split(/\s+/).length >= 5 && !this.isIncompleteSentence(text);
    const delay = isPunctuationQuestion ? 2000 : this.BUFFER_DEBOUNCE_MS;

    buf.timer = setTimeout(() => {
      this.evaluateBuffer(sessionId);
    }, delay);
  }

  /**
   * Evaluates the buffered speech chunks for questions
   */
  private evaluateBuffer(sessionId: string): void {
    const buf = this.buffers.get(sessionId);
    if (!buf || buf.chunks.length === 0) return;

    const fullText = buf.chunks.join(' ').replace(/\s+/g, ' ').trim();
    if (!fullText) return;

    // Check if the current sentence is visibly incomplete or ends with a hanging conjunction/preposition
    if (this.isIncompleteSentence(fullText) && buf.incompleteRetries < 2) {
      buf.incompleteRetries++;
      // Still an incomplete thought / sentence fragment, wait for next speech chunk
      buf.timer = setTimeout(() => {
        this.evaluateBuffer(sessionId);
      }, 2800);
      return;
    }

    const transcriptId = buf.transcriptIds[buf.transcriptIds.length - 1];

    // Clear buffer
    buf.chunks = [];
    buf.transcriptIds = [];
    buf.timer = null;
    buf.incompleteRetries = 0;

    // Check if fullText constitutes a question
    const detection = this.analyzeQuestion(fullText);
    if (detection.isQuestion) {
      const detectedQuestion: DetectedQuestion = {
        id: `q-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        sessionId,
        transcriptId,
        questionText: detection.cleanedQuestion,
        type: detection.category,
        confidence: detection.confidence,
        timestamp: Date.now(),
      };

      this.onQuestionDetected(detectedQuestion);
    }
  }

  /**
   * Checks if a sentence fragment is visibly incomplete (e.g. ends with prepositions, conjunctions, or dangling auxiliary verbs)
   */
  public isIncompleteSentence(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 8) return true;

    // Words that should never be the terminal word of a completed interview question
    const danglingEndRegex = /\b(?:the|a|an|and|or|but|if|how|what|why|when|where|which|who|whom|whose|with|for|to|of|in|at|by|from|about|like|because|as|that|this|these|those|handle|handles|handling|is|are|was|were|will|would|can|could|should|do|does|did|into|onto|through|between|such|so|my|your|our|their|than|then|either|neither)\b[\s,.]*$/i;

    if (danglingEndRegex.test(trimmed)) {
      return true;
    }

    // Dependent clause without a main clause (e.g., "like if node.js is single-threaded")
    if (/^(?:like\s+)?if\b/i.test(trimmed) && !/\b(?:then|how|what|why|can|will|does|do|explain)\b/i.test(trimmed) && !trimmed.endsWith('?')) {
      return true;
    }

    return false;
  }

  /**
   * Analyzes if a text is a genuine question and classifies it
   */
  public analyzeQuestion(text: string): {
    isQuestion: boolean;
    cleanedQuestion: string;
    category: QuestionCategory;
    confidence: number;
  } {
    const trimmed = text.trim();
    if (trimmed.length < 8) {
      return { isQuestion: false, cleanedQuestion: trimmed, category: 'General', confidence: 0 };
    }

    // Exclude common conversation fillers and acknowledgments
    const fillerRegex = /^(right\??|okay\??|you know\??|makes sense\??|yeah\??|got it\??|sure\??|uh-huh\??|cool\??|yep\??|nope\??)$/i;
    if (fillerRegex.test(trimmed)) {
      return { isQuestion: false, cleanedQuestion: trimmed, category: 'General', confidence: 0 };
    }

    // Exclude greetings, pleasantries, mic checks, and conversational small talk
    // E.g., "Hello hi are you", "Hello, how are you?", "Can you hear me?", "Hi can you hear me?", "Good morning"
    const smallTalkPatterns = [
      /^(hello|hi|hey|good\s+(morning|afternoon|evening)|morning|afternoon|evening)[\s,.]*$/i,
      /^(hello|hi|hey)?[\s,.]*(how\s+(are\s+you|r\s+u|is\s+it\s+going)|how's\s+it\s+going|how\s+do\s+you\s+do)[\s?.!]*$/i,
      /^(hello|hi|hey)?[\s,.]*(can\s+you\s+hear\s+me|am\s+i\s+audible|are\s+you\s+there|you\s+there)[\s?.!]*$/i,
      /^(hello|hi|hey)?[\s,.]*(nice\s+to\s+meet\s+you|glad\s+to\s+be\s+here|thanks\s+for\s+having\s+me)[\s?.!]*$/i,
      /^(testing|test\s+test|check\s+check|mic\s+check|sound\s+check|audio\s+check)[\s?.!]*$/i,
      /^(hello\s+hi|hi\s+hello|hello\s+hi\s+are\s+you|hi\s+are\s+you|hello\s+are\s+you|hey\s+are\s+you)[\s?.!]*$/i,
    ];

    if (smallTalkPatterns.some(p => p.test(trimmed))) {
      return { isQuestion: false, cleanedQuestion: trimmed, category: 'General', confidence: 0 };
    }

    const lower = trimmed.toLowerCase();

    // Question patterns
    const questionStarters = [
      'can you', 'could you', 'would you', 'will you',
      'how do you', 'how does', 'how would', 'how can', 'how did',
      'what is', 'what are', 'what was', 'what would', 'what do', 'what does', 'what happens',
      'why is', 'why do', 'why would', 'why should', 'why did',
      'tell me about', 'explain', 'describe', 'walk me through',
      'have you ever', 'have you worked', 'have you used',
      'is there a way', 'is it possible', 'do you know',
      'difference between', 'compare', 'which one'
    ];

    const hasExplicitQuestionMark = trimmed.includes('?');
    const matchedStarter = questionStarters.find(starter => lower.includes(starter));

    if (!hasExplicitQuestionMark && !matchedStarter) {
      return { isQuestion: false, cleanedQuestion: trimmed, category: 'General', confidence: 0 };
    }

    // Determine category based on keywords
    let category: QuestionCategory = 'General';
    let confidence = 0.85;

    // Behavioral
    if (
      lower.includes('tell me about a time') ||
      lower.includes('describe a situation') ||
      lower.includes('biggest challenge') ||
      lower.includes('conflict') ||
      lower.includes('mistake') ||
      lower.includes('disagreement') ||
      lower.includes('leadership') ||
      lower.includes('proud of') ||
      lower.includes('past experience')
    ) {
      category = 'Behavioral';
      confidence = 0.95;
    }
    // System Design
    else if (
      lower.includes('system design') ||
      lower.includes('design a') ||
      lower.includes('architect') ||
      lower.includes('scale') ||
      lower.includes('high availability') ||
      lower.includes('microservice') ||
      lower.includes('rate limiter') ||
      lower.includes('notification system') ||
      lower.includes('caching strategy') ||
      lower.includes('partition') ||
      lower.includes('throughput') ||
      lower.includes('load balancer')
    ) {
      category = 'System Design';
      confidence = 0.94;
    }
    // Coding / Algorithms
    else if (
      lower.includes('time complexity') ||
      lower.includes('space complexity') ||
      lower.includes('big o') ||
      lower.includes('algorithm') ||
      lower.includes('write a function') ||
      lower.includes('implement') ||
      lower.includes('binary tree') ||
      lower.includes('graph') ||
      lower.includes('dynamic programming') ||
      lower.includes('sort') ||
      lower.includes('array') ||
      lower.includes('linked list')
    ) {
      category = 'Coding';
      confidence = 0.92;
    }
    // Technical Deep Dive
    else if (
      lower.includes('react') ||
      lower.includes('fiber') ||
      lower.includes('jsi') ||
      lower.includes('bridge') ||
      lower.includes('turbomodules') ||
      lower.includes('concurrency') ||
      lower.includes('memory') ||
      lower.includes('garbage collection') ||
      lower.includes('database') ||
      lower.includes('sql') ||
      lower.includes('nosql') ||
      lower.includes('index') ||
      lower.includes('kafka') ||
      lower.includes('redis') ||
      lower.includes('docker') ||
      lower.includes('kubernetes') ||
      lower.includes('typescript') ||
      lower.includes('lifecycle') ||
      lower.includes('hook') ||
      lower.includes('virtual dom') ||
      lower.includes('node') ||
      lower.includes('event loop')
    ) {
      category = 'Technical';
      confidence = 0.93;
    }
    // Follow-up
    else if (
      lower.startsWith('why') ||
      lower.startsWith('and what about') ||
      lower.startsWith('then why') ||
      lower.startsWith('so how') ||
      lower.includes('in that case')
    ) {
      category = 'Follow-up';
      confidence = 0.88;
    }
    // Experience
    else if (
      lower.includes('in your resume') ||
      lower.includes('in your current role') ||
      lower.includes('at your previous company') ||
      lower.includes('what technologies have you used')
    ) {
      category = 'Experience';
      confidence = 0.90;
    }

    // Clean question formatting
    let cleaned = trimmed;
    if (!cleaned.endsWith('?')) {
      cleaned += '?';
    }
    // Capitalize first letter
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);

    return {
      isQuestion: true,
      cleanedQuestion: cleaned,
      category,
      confidence,
    };
  }

  public clearSession(sessionId: string): void {
    const buf = this.buffers.get(sessionId);
    if (buf && buf.timer) {
      clearTimeout(buf.timer);
    }
    this.buffers.delete(sessionId);
  }
}
