import dotenv from 'dotenv';
import path from 'path';
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../server/.env') });

export interface TranscriptionResult {
  text: string;
  confidence: number;
  durationMs?: number;
  engine: 'groq' | 'openai' | 'local_heuristic';
}

export class SpeechEngine {
  private groqApiKey: string | undefined;
  private openaiApiKey: string | undefined;

  constructor() {
    this.groqApiKey = process.env.GROQ_API_KEY;
    this.openaiApiKey = process.env.OPENAI_API_KEY;
  }

  public setApiKey(provider: 'groq' | 'openai', key: string): void {
    if (provider === 'groq') this.groqApiKey = key;
    if (provider === 'openai') this.openaiApiKey = key;
  }

  public getStatus(): {
    groqConfigured: boolean;
    openaiConfigured: boolean;
    recommendedProvider: string;
  } {
    return {
      groqConfigured: !!this.groqApiKey,
      openaiConfigured: !!this.openaiApiKey,
      recommendedProvider: this.groqApiKey ? 'groq-whisper-turbo' : this.openaiApiKey ? 'openai-whisper' : 'browser-native-stt',
    };
  }

  /**
   * Transcribes an audio buffer (WebM / Opus / WAV / MP3 / MP4) into text.
   * Priority: Groq Whisper (~150ms latency) -> OpenAI Whisper -> Error description
   */
  public async transcribeAudio(
    audioBuffer: Buffer,
    mimeType: string = 'audio/webm'
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();

    // 1. Try Groq Whisper Turbo (~150-250ms)
    if (this.groqApiKey) {
      try {
        const result = await this.callWhisperApi(
          'https://api.groq.com/openai/v1/audio/transcriptions',
          this.groqApiKey,
          'whisper-large-v3-turbo',
          audioBuffer,
          mimeType
        );
        const cleanText = result.text.trim();
        if (this.isSilenceHallucination(cleanText)) {
          return {
            text: '',
            confidence: 0,
            durationMs: Date.now() - startTime,
            engine: 'groq',
          };
        }
        return {
          text: cleanText,
          confidence: 0.96,
          durationMs: Date.now() - startTime,
          engine: 'groq',
        };
      } catch (err: any) {
        // Fallback to Groq Whisper v3 standard model (separate RPM bucket)
        try {
          const result = await this.callWhisperApi(
            'https://api.groq.com/openai/v1/audio/transcriptions',
            this.groqApiKey,
            'whisper-large-v3',
            audioBuffer,
            mimeType
          );
          const cleanText = result.text.trim();
          if (this.isSilenceHallucination(cleanText)) {
            return {
              text: '',
              confidence: 0,
              durationMs: Date.now() - startTime,
              engine: 'groq',
            };
          }
          return {
            text: cleanText,
            confidence: 0.96,
            durationMs: Date.now() - startTime,
            engine: 'groq',
          };
        } catch (v3Err: any) {
          console.warn('[SpeechEngine] Groq Whisper (turbo & v3) notice:', err.message);
        }
      }
    }

    // 2. Try OpenAI Whisper
    if (this.openaiApiKey) {
      try {
        const result = await this.callWhisperApi(
          'https://api.openai.com/v1/audio/transcriptions',
          this.openaiApiKey,
          'whisper-1',
          audioBuffer,
          mimeType
        );
        const cleanText = result.text.trim();
        if (this.isSilenceHallucination(cleanText)) {
          return {
            text: '',
            confidence: 0,
            durationMs: Date.now() - startTime,
            engine: 'openai',
          };
        }
        return {
          text: cleanText,
          confidence: 0.95,
          durationMs: Date.now() - startTime,
          engine: 'openai',
        };
      } catch (err: any) {
        console.warn('[SpeechEngine] OpenAI Whisper failed:', err.message);
      }
    }

    throw new Error(
      'No Speech-to-Text API key configured. Please set GROQ_API_KEY or OPENAI_API_KEY in server/.env, or use Google Chrome for native real-time Web Speech recognition.'
    );
  }

  /**
   * Identifies common Whisper silence/ambient noise hallucinations (e.g. "Thank you.", ".", "Bye.", etc.)
   */
  public isSilenceHallucination(rawText: string): boolean {
    if (!rawText) return true;
    const text = rawText.trim();
    if (text.length < 2) return true;

    // Pure punctuation or noise characters (e.g. ".", "..", "...", "-", "?", "!", "…")
    if (/^[\s\.\,\?\!\-\_\:\;\'\"…\(\)\[\]]+$/.test(text)) {
      return true;
    }

    const lower = text.toLowerCase().replace(/^[^\w]+|[^\w]+$/g, '').trim();

    // Known Whisper hallucinations generated on background noise, air puffs, or silence
    const silenceHallucinations = [
      'thank you',
      'thank you.',
      'thank you so much',
      'thank you very much',
      'thank you for watching',
      'thanks for watching',
      'thanks',
      'please subscribe',
      'subscribe to my channel',
      'bye',
      'goodbye',
      'okay',
      'ok',
      'the end',
      'you',
      'silence',
      'music',
      'applause',
      'subtitles by',
      'subtitles by the amara.org community',
      'mbc',
      'watching',
    ];

    if (silenceHallucinations.includes(lower)) {
      return true;
    }

    // Repeated single-phrase hallucinations like "Thank you. Thank you."
    if (/^(thank\s+you[\s.,!]*)+$/i.test(text)) {
      return true;
    }

    if (/^(subtitles?|caption(s|ed)?)\s+by/i.test(text)) {
      return true;
    }

    return false;
  }

  private async callWhisperApi(
    url: string,
    apiKey: string,
    model: string,
    audioBuffer: Buffer,
    mimeType: string
  ): Promise<{ text: string }> {
    const formData = new FormData();
    const arrayBuffer = audioBuffer.buffer.slice(
      audioBuffer.byteOffset,
      audioBuffer.byteOffset + audioBuffer.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: mimeType });
    const isWav = mimeType.includes('wav');
    const isMp4 = mimeType.includes('mp4');
    const fileName = isWav ? 'audio.wav' : isMp4 ? 'audio.mp4' : 'audio.webm';
    formData.append('file', blob, fileName);
    formData.append('model', model);
    formData.append('response_format', 'json');
    formData.append('language', 'en');
    formData.append('temperature', '0.0');
    formData.append(
      'prompt',
      'Software engineering technical interview, system architecture, programming, coding, algorithms, technical conversation.'
    );

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Whisper API HTTP ${res.status}: ${errorText}`);
    }

    return (await res.json()) as { text: string };
  }
}
