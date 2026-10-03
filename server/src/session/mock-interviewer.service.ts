import { Injectable } from '@nestjs/common';
import { MockInterviewer, MOCK_SCENARIOS, SimulationScenario } from '../mockInterviewer.js';
import { TranscriptItem } from '../types.js';

@Injectable()
export class MockInterviewerService {
  private interviewer: MockInterviewer;
  private handler: ((transcript: TranscriptItem) => void) | null = null;

  constructor() {
    this.interviewer = new MockInterviewer((t: TranscriptItem) => {
      if (this.handler) {
        this.handler(t);
      }
    });
  }

  public setOnTranscriptEmitted(handler: (transcript: TranscriptItem) => void): void {
    this.handler = handler;
  }

  public startScenario(sessionId: string, scenarioId: string): boolean {
    return this.interviewer.startScenario(sessionId, scenarioId);
  }

  public stopScenario(sessionId: string): void {
    this.interviewer.stopScenario(sessionId);
  }

  public isRunning(sessionId: string): boolean {
    return this.interviewer.isRunning(sessionId);
  }

  public getScenarios(): SimulationScenario[] {
    return MOCK_SCENARIOS;
  }
}
