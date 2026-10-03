import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { WebSocket, Server } from 'ws';
import { SessionService } from './session.service.js';
import { ContextService } from '../context/context.service.js';
import { AiService } from '../ai/ai.service.js';
import { QuestionDetectorService } from './question-detector.service.js';
import { MockInterviewerService } from './mock-interviewer.service.js';
import {
  DetectedQuestion,
  DeviceInfo,
  GeneratedAnswer,
  SessionNote,
  SessionState,
  TranscriptItem,
  WSMessage,
} from '../types.js';

@Injectable()
@WebSocketGateway({ path: '/ws' })
export class SessionGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(SessionGateway.name);
  private sessionClients: Map<string, Set<WebSocket>> = new Map();
  private clientMetadata: Map<WebSocket, { sessionId?: string; deviceId?: string }> = new Map();

  constructor(
    private readonly sessionService: SessionService,
    private readonly contextService: ContextService,
    private readonly aiService: AiService,
    private readonly questionDetectorService: QuestionDetectorService,
    private readonly mockInterviewerService: MockInterviewerService
  ) {}

  onModuleInit() {
    // 1. Wire automatic question detector to streaming AI answer generation
    this.questionDetectorService.setOnQuestionDetected(async (question: DetectedQuestion) => {
      this.sessionService.addQuestion(question);
      this.broadcastToSession(question.sessionId, {
        event: 'question.detected',
        sessionId: question.sessionId,
        payload: question,
      });
      await this.triggerAnswerGeneration(question);
    });

    // 2. Wire mock interviewer simulation
    this.mockInterviewerService.setOnTranscriptEmitted((transcript: TranscriptItem) => {
      this.handleTranscriptIngestion(transcript);
    });
  }

  afterInit(server: Server) {
    this.server = server;
    this.logger.log('🚀 NestJS WebSocket Gateway initialized on /ws');
  }

  handleConnection(client: WebSocket, req?: any) {
    const meta: { sessionId?: string; deviceId?: string } = {};
    this.clientMetadata.set(client, meta);

    client.on('message', async (raw: Buffer | string) => {
      await this.processMessage(client, raw);
    });
  }

  handleDisconnect(client: WebSocket) {
    const meta = this.clientMetadata.get(client);
    if (meta && meta.sessionId) {
      const clients = this.sessionClients.get(meta.sessionId);
      if (clients) {
        clients.delete(client);
        if (clients.size === 0) {
          this.sessionClients.delete(meta.sessionId);
        }
      }

      if (meta.deviceId) {
        const curSession = this.sessionService.getSession(meta.sessionId);
        const dev = curSession?.devices?.find(d => d.id === meta.deviceId);
        if (dev?.role === 'PRIMARY_CAPTURE') {
          this.sessionService.removeDevice(meta.sessionId, meta.deviceId);
          this.broadcastToSession(meta.sessionId, {
            event: 'device.disconnected',
            sessionId: meta.sessionId,
            payload: { deviceId: meta.deviceId },
          });
        } else {
          // Grace period for mobile / second screen: do not immediately delete device on transient disconnect
          const targetSessionId = meta.sessionId;
          const targetDeviceId = meta.deviceId;
          setTimeout(() => {
            const recheckSession = this.sessionService.getSession(targetSessionId);
            const clients = this.sessionClients.get(targetSessionId);
            const isClientActive = clients && Array.from(clients).some(c => {
              const clientMeta = this.clientMetadata.get(c);
              return clientMeta?.deviceId === targetDeviceId;
            });

            if (!isClientActive && recheckSession) {
              this.sessionService.removeDevice(targetSessionId, targetDeviceId);
              this.broadcastToSession(targetSessionId, {
                event: 'device.disconnected',
                sessionId: targetSessionId,
                payload: { deviceId: targetDeviceId },
              });
            }
          }, 45000);
        }
      }
    }
    this.clientMetadata.delete(client);
  }

  public broadcastToSession(sessionId: string, message: WSMessage, excludeWs?: WebSocket): void {
    const clients = this.sessionClients.get(sessionId);
    if (!clients || clients.size === 0) {
      return;
    }

    const data = JSON.stringify(message);
    let sentCount = 0;
    for (const client of clients) {
      if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
        client.send(data);
        sentCount++;
      }
    }
  }

  public async triggerAnswerGeneration(
    question: DetectedQuestion,
    actionModifier?: 'shorter' | 'expand' | 'example' | 'technical_detail' | 'star' | 'alternative'
  ): Promise<void> {
    const session = this.sessionService.getSession(question.sessionId);
    if (!session) return;

    // Retrieve RAG Context
    const relevantChunks = this.contextService.retrieveContext(
      session.profile?.id,
      question.questionText,
      3
    );

    const recentTranscripts = this.sessionService
      .getTranscripts(question.sessionId)
      .slice(-6)
      .map(t => ({
        speaker: t.speaker,
        text: t.text,
      }));

    try {
      await this.aiService.streamAnswer(
        question,
        session.type,
        session.answerLength,
        relevantChunks.map(r => r.chunk),
        recentTranscripts,
        {
          onStart: (answer: GeneratedAnswer) => {
            this.sessionService.addOrUpdateAnswer(answer);
            this.broadcastToSession(question.sessionId, {
              event: 'answer.started',
              sessionId: question.sessionId,
              payload: answer,
            });
          },
          onToken: (token: string, accumulated: string) => {
            this.broadcastToSession(question.sessionId, {
              event: 'answer.token',
              sessionId: question.sessionId,
              payload: {
                answerId: question.id,
                token,
                accumulated,
              },
            });
          },
          onComplete: (answer: GeneratedAnswer) => {
            this.sessionService.addOrUpdateAnswer(answer);
            this.broadcastToSession(question.sessionId, {
              event: 'answer.completed',
              sessionId: question.sessionId,
              payload: answer,
            });
          },
          onError: (err: any) => {
            this.broadcastToSession(question.sessionId, {
              event: 'error',
              sessionId: question.sessionId,
              payload: { message: err?.message || 'Error generating answer' },
            });
          },
        },
        actionModifier
      );
    } catch (err) {
      this.logger.error('Error in triggerAnswerGeneration:', err);
    }
  }

  public handleTranscriptIngestion(transcript: TranscriptItem): void {
    this.sessionService.addTranscript(transcript);
    this.broadcastToSession(transcript.sessionId, {
      event: 'transcript.final',
      sessionId: transcript.sessionId,
      payload: transcript,
    });
    this.questionDetectorService.ingestTranscript(transcript);
  }

  private async processMessage(client: WebSocket, raw: Buffer | string): Promise<void> {
    try {
      const msg: WSMessage = JSON.parse(raw.toString());
      const sessionId = msg.sessionId;
      const meta = this.clientMetadata.get(client) || {};

      if (sessionId) {
        meta.sessionId = sessionId;
        if (!this.sessionClients.has(sessionId)) {
          this.sessionClients.set(sessionId, new Set());
        }
        this.sessionClients.get(sessionId)?.add(client);
      }

      switch (msg.event) {
        case 'ping': {
          const curSess = sessionId ? this.sessionService.getSession(sessionId) : undefined;
          client.send(
            JSON.stringify({
              event: 'pong',
              sessionId,
              payload: { time: Date.now(), durationSeconds: curSess?.durationSeconds },
            })
          );
          break;
        }

        case 'session.create': {
          const { type, title, profile, experienceLevel } = msg.payload || {};
          const session = this.sessionService.createSession(type, title, profile, experienceLevel);
          meta.sessionId = session.id;

          if (!this.sessionClients.has(session.id)) {
            this.sessionClients.set(session.id, new Set());
          }
          this.sessionClients.get(session.id)?.add(client);

          client.send(
            JSON.stringify({
              event: 'session.created',
              sessionId: session.id,
              payload: session,
            })
          );
          break;
        }

        case 'session.join': {
          const { sessionId, code, device } = msg.payload as {
            sessionId?: string;
            code?: string;
            device: DeviceInfo;
          };

          const session = sessionId
            ? this.sessionService.getSession(sessionId)
            : code
              ? this.sessionService.getSessionByCode(code)
              : undefined;

          if (!session) {
            client.send(
              JSON.stringify({
                event: 'error',
                payload: { message: 'Session not found or invalid code' },
              })
            );
            return;
          }

          meta.sessionId = session.id;
          if (device?.id) meta.deviceId = device.id;

          if (!this.sessionClients.has(session.id)) {
            this.sessionClients.set(session.id, new Set());
          }
          this.sessionClients.get(session.id)?.add(client);

          if (device) {
            this.sessionService.addDevice(session.id, device);
          }

          // Reply with joined session state and full history
          client.send(
            JSON.stringify({
              event: 'session.joined',
              sessionId: session.id,
              payload: {
                session,
                transcripts: this.sessionService.getTranscripts(session.id),
                questions: this.sessionService.getQuestions(session.id),
                answers: this.sessionService.getAnswers(session.id),
                notes: this.sessionService.getNotes(session.id),
                currentQuestion: this.sessionService.getCurrentQuestion(session.id),
              },
            })
          );

          // Broadcast device connection to others in session
          if (device) {
            this.broadcastToSession(
              session.id,
              {
                event: 'device.connected',
                sessionId: session.id,
                payload: device,
              },
              client
            );
          }
          break;
        }

        case 'session.update': {
          if (!sessionId) return;
          const { answerLength } = msg.payload || {};
          if (answerLength) {
            this.sessionService.updateAnswerLength(sessionId, answerLength);
            this.broadcastToSession(sessionId, {
              event: 'session.update',
              sessionId,
              payload: { answerLength },
            });
          }
          break;
        }

        case 'audio.status': {
          if (!sessionId) return;
          const { micActive, systemAudioActive } = msg.payload || {};
          this.sessionService.setAudioStatus(sessionId, micActive, systemAudioActive);
          this.broadcastToSession(
            sessionId,
            {
              event: 'audio.status',
              sessionId,
              payload: { micActive, systemAudioActive },
            },
            client
          );
          break;
        }

        case 'transcript.partial': {
          if (!sessionId) return;
          this.broadcastToSession(
            sessionId,
            {
              event: 'transcript.partial',
              sessionId,
              payload: msg.payload,
            },
            client
          );
          break;
        }

        case 'transcript.final': {
          if (!sessionId) return;
          const { speaker, text } = msg.payload || {};
          if (!text || !text.trim()) return;

          const transcript: TranscriptItem = {
            id: `tr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            sessionId,
            speaker: speaker || 'OTHER',
            text: text.trim(),
            isFinal: true,
            timestamp: Date.now(),
            confidence: 0.95,
          };

          this.handleTranscriptIngestion(transcript);
          break;
        }

        case 'action.regenerate': {
          if (!sessionId) return;
          const { questionId, modifier } = msg.payload || {};
          const questions = this.sessionService.getQuestions(sessionId);
          const targetQ = questions.find(q => q.id === questionId);
          if (targetQ) {
            await this.triggerAnswerGeneration(targetQ, modifier);
          }
          break;
        }

        case 'manual.ask': {
          if (!sessionId) return;
          const { questionText } = msg.payload || {};
          if (!questionText || !questionText.trim()) return;

          const manualQ: DetectedQuestion = {
            id: `q-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            sessionId,
            questionText: questionText.trim(),
            type: 'manual',
            timestamp: Date.now(),
            confidence: 1.0,
          };

          this.sessionService.addQuestion(manualQ);
          this.broadcastToSession(sessionId, {
            event: 'question.detected',
            sessionId,
            payload: manualQ,
          });

          await this.triggerAnswerGeneration(manualQ);
          break;
        }

        case 'note.create': {
          if (!sessionId) return;
          const { text, questionId } = msg.payload || {};
          if (!text) return;

          const note: SessionNote = {
            id: `note-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            sessionId,
            questionId,
            text: text.trim(),
            timestamp: Date.now(),
          };

          this.sessionService.addNote(note);
          this.broadcastToSession(sessionId, {
            event: 'note.created',
            sessionId,
            payload: note,
          });
          break;
        }

        case 'session.pause': {
          if (!sessionId) return;
          const session = this.sessionService.pauseSession(sessionId);
          this.broadcastToSession(sessionId, {
            event: 'session.paused',
            sessionId,
            payload: { durationSeconds: session?.durationSeconds },
          });
          break;
        }

        case 'session.resume': {
          if (!sessionId) return;
          const session = this.sessionService.resumeSession(sessionId);
          this.broadcastToSession(sessionId, {
            event: 'session.resumed',
            sessionId,
            payload: { durationSeconds: session?.durationSeconds },
          });
          break;
        }

        case 'session.end': {
          if (!sessionId) return;
          const session = this.sessionService.endSession(sessionId);
          this.mockInterviewerService.stopScenario(sessionId);
          this.questionDetectorService.clearSession(sessionId);
          const summary = this.sessionService.generateSummary(sessionId);

          this.broadcastToSession(sessionId, {
            event: 'session.ended',
            sessionId,
            payload: { summary, durationSeconds: session?.durationSeconds },
          });
          break;
        }

        case 'mock.start': {
          if (!sessionId) return;
          const { scenarioId } = msg.payload || {};
          this.mockInterviewerService.startScenario(sessionId, scenarioId || 'react-native-lead');
          this.broadcastToSession(sessionId, {
            event: 'mock.started',
            sessionId,
            payload: { scenarioId: scenarioId || 'react-native-lead' },
          });
          break;
        }

        case 'mock.stop': {
          if (!sessionId) return;
          this.mockInterviewerService.stopScenario(sessionId);
          this.broadcastToSession(sessionId, {
            event: 'mock.stopped',
            sessionId,
            payload: { sessionId, status: 'stopped' },
          });
          break;
        }

        default:
          break;
      }
    } catch (err) {
      this.logger.error('Failed to handle incoming WebSocket message:', err);
    }
  }
}
