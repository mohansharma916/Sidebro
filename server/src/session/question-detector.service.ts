import { Injectable } from '@nestjs/common';
import { QuestionDetector } from '../questionDetector.js';
import { DetectedQuestion } from '../types.js';

@Injectable()
export class QuestionDetectorService {
  private detector: QuestionDetector;
  private handler: ((question: DetectedQuestion) => void) | null = null;

  constructor() {
    this.detector = new QuestionDetector((q: DetectedQuestion) => {
      if (this.handler) {
        this.handler(q);
      }
    });
  }

  public setOnQuestionDetected(handler: (question: DetectedQuestion) => void): void {
    this.handler = handler;
  }

  public ingestTranscript(transcript: any): void {
    this.detector.ingestTranscript(transcript);
  }

  public clearSession(sessionId: string): void {
    this.detector.clearSession(sessionId);
  }
}
