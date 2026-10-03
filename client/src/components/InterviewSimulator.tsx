import React, { useState } from 'react';
import { Play, Square, FastForward, CheckCircle2 } from 'lucide-react';

interface InterviewSimulatorProps {
  sessionId: string;
  onSimulateChunk?: (speaker: 'OTHER' | 'YOU', text: string) => void;
}

export const InterviewSimulator: React.FC<InterviewSimulatorProps> = ({
  sessionId,
  onSimulateChunk,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [activeScenario, setActiveScenario] = useState('react-native-lead');

  const startSimulation = async () => {
    setIsRunning(true);
    try {
      await fetch('/api/simulation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, scenarioId: activeScenario }),
      });
    } catch (e) {
      console.error('[Simulator] Start failed:', e);
    }
  };

  const stopSimulation = async () => {
    setIsRunning(false);
    try {
      await fetch('/api/simulation/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } catch (e) {
      console.error('[Simulator] Stop failed:', e);
    }
  };

  // Quick single trigger buttons for instant test
  const quickTestQuestions = [
    { label: "React Fiber", q: "How does React Fiber work under the hood?" },
    { label: "Bridge vs JSI", q: "Can you explain the difference between the React Native Bridge and JSI?" },
    { label: "STAR Incident", q: "Tell me about a time when a critical production incident occurred." },
    { label: "Rate Limiter", q: "How would you design a distributed rate limiter to handle 100k+ RPS?" },
  ];

  return (
    <div className="glass-panel" style={{ padding: '16px 20px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <span style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#00f2fe', fontWeight: 700 }}>
            Interactive Interview Simulator (PRD Section 69)
          </span>
          <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: '2px' }}>
            Simulate realistic interviewer speech to test automatic question detection & real-time answers.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <select
            value={activeScenario}
            onChange={e => setActiveScenario(e.target.value)}
            disabled={isRunning}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#f8fafc',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '8px',
              padding: '6px 10px',
              fontSize: '0.8rem',
              outline: 'none',
            }}
          >
            <option value="react-native-lead" style={{ background: '#0d121d' }}>Senior React Native Interview</option>
            <option value="system-design" style={{ background: '#0d121d' }}>System Design: Rate Limiter</option>
            <option value="behavioral-star" style={{ background: '#0d121d' }}>Behavioral STAR: Incident Response</option>
          </select>

          {isRunning ? (
            <button onClick={stopSimulation} className="btn btn-danger btn-sm">
              <Square size={13} /> Stop Sim
            </button>
          ) : (
            <button onClick={startSimulation} className="btn btn-primary btn-sm">
              <Play size={13} /> Run Full Call
            </button>
          )}
        </div>
      </div>

      {/* Quick 1-click Test Questions */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginTop: '12px',
        paddingTop: '10px',
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: '0.72rem', color: '#64748b' }}>1-Click Audio Sim:</span>
        {quickTestQuestions.map((t, idx) => (
          <button
            key={idx}
            onClick={() => onSimulateChunk?.('OTHER', t.q)}
            className="chip"
            style={{ fontSize: '0.74rem' }}
            title={t.q}
          >
            <FastForward size={11} color="#00f2fe" /> {t.label}
          </button>
        ))}
      </div>
    </div>
  );
};
