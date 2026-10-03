import { TranscriptItem } from './types.js';

export interface SimulationStep {
  speaker: 'OTHER' | 'YOU';
  text: string;
  pauseAfterMs: number;
}

export interface SimulationScenario {
  id: string;
  name: string;
  description: string;
  steps: SimulationStep[];
}

export const MOCK_SCENARIOS: SimulationScenario[] = [
  {
    id: 'react-native-lead',
    name: 'Senior React Native Interview',
    description: 'Covers React Fiber, Bridge vs JSI, performance, and TurboModules.',
    steps: [
      {
        speaker: 'OTHER',
        text: "Thanks for joining today! I see from your background that you have deep experience in React Native and high-performance apps.",
        pauseAfterMs: 2500,
      },
      {
        speaker: 'YOU',
        text: "Yes, absolutely! I've been working with React Native for over 5 years, most recently migrating high-traffic video applications to the new architecture.",
        pauseAfterMs: 2000,
      },
      {
        speaker: 'OTHER',
        text: "Great! Let's dive in. How does the React Fiber reconciliation architecture work under the hood?",
        pauseAfterMs: 6000,
      },
      {
        speaker: 'YOU',
        text: "React Fiber breaks reconciliation into interruptible units of work using priority lanes and double buffering.",
        pauseAfterMs: 2500,
      },
      {
        speaker: 'OTHER',
        text: "Interesting. Can you explain the difference between the legacy React Native Bridge and JSI?",
        pauseAfterMs: 6500,
      },
      {
        speaker: 'OTHER',
        text: "Then why are TurboModules useful, and how do they benefit app startup time?",
        pauseAfterMs: 6000,
      },
      {
        speaker: 'OTHER',
        text: "How have you improved application performance and resolved frame drops in FlatLists?",
        pauseAfterMs: 6000,
      },
    ],
  },
  {
    id: 'system-design',
    name: 'System Design: Distributed Rate Limiter',
    description: 'Covers API scale, sliding window, Redis clusters, and failure handling.',
    steps: [
      {
        speaker: 'OTHER',
        text: "Let's move on to the system design round. We want to design a distributed rate limiter for our public API gateway handling 150,000 requests per second.",
        pauseAfterMs: 3000,
      },
      {
        speaker: 'OTHER',
        text: "How would you design a distributed rate limiter to handle 100k+ RPS with sub-millisecond latency?",
        pauseAfterMs: 6500,
      },
      {
        speaker: 'OTHER',
        text: "Why would you choose Sliding Window over Token Bucket, and how do you handle Redis cluster partition failures?",
        pauseAfterMs: 6000,
      },
    ],
  },
  {
    id: 'behavioral-star',
    name: 'Behavioral STAR: High-Stakes Incident',
    description: 'Covers production outages, blameless post-mortems, and leadership.',
    steps: [
      {
        speaker: 'OTHER',
        text: "Tell me about a time when a critical production incident occurred. How did you diagnose the issue and lead the resolution?",
        pauseAfterMs: 6500,
      },
      {
        speaker: 'OTHER',
        text: "How did you communicate with stakeholders and non-technical executives during the outage?",
        pauseAfterMs: 5000,
      },
    ],
  },
];

export class MockInterviewer {
  private activeSimulations: Map<string, { timer: NodeJS.Timeout | null; stepIndex: number }> = new Map();
  private onTranscript: (transcript: TranscriptItem) => void;

  constructor(onTranscript: (transcript: TranscriptItem) => void) {
    this.onTranscript = onTranscript;
  }

  public startScenario(sessionId: string, scenarioId = 'react-native-lead'): boolean {
    this.stopScenario(sessionId);

    const scenario = MOCK_SCENARIOS.find(s => s.id === scenarioId) || MOCK_SCENARIOS[0];
    this.activeSimulations.set(sessionId, { timer: null, stepIndex: 0 });

    this.runNextStep(sessionId, scenario);
    return true;
  }

  public isRunning(sessionId: string): boolean {
    return this.activeSimulations.has(sessionId);
  }

  private runNextStep(sessionId: string, scenario: SimulationScenario): void {
    const sim = this.activeSimulations.get(sessionId);
    if (!sim || sim.stepIndex >= scenario.steps.length) {
      this.stopScenario(sessionId);
      return;
    }

    const currentStep = scenario.steps[sim.stepIndex];

    // Emit partial speech then final transcript to simulate real streaming STT
    const transcript: TranscriptItem = {
      id: `sim-tr-${Date.now()}-${sim.stepIndex}`,
      sessionId,
      speaker: currentStep.speaker,
      text: currentStep.text,
      isFinal: true,
      timestamp: Date.now(),
      confidence: 0.98,
    };

    this.onTranscript(transcript);
    sim.stepIndex++;

    sim.timer = setTimeout(() => {
      this.runNextStep(sessionId, scenario);
    }, currentStep.pauseAfterMs);
  }

  public stopScenario(sessionId: string): void {
    const sim = this.activeSimulations.get(sessionId);
    if (sim && sim.timer) {
      clearTimeout(sim.timer);
    }
    this.activeSimulations.delete(sessionId);
  }
}
