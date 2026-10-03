import React, { useState, useEffect } from 'react';
import { Laptop, Mic, Volume2, Cpu, Wifi, Clock, Pause, Play, PowerOff } from 'lucide-react';
import { SessionState } from '../types';

interface DeviceHealthBarProps {
  session: SessionState | null;
  latencyMs: number;
  onPause?: () => void;
  onResume?: () => void;
  onEnd?: () => void;
  isPrimary?: boolean;
}

export const DeviceHealthBar: React.FC<DeviceHealthBarProps> = ({
  session,
  latencyMs,
  onPause,
  onResume,
  onEnd,
  isPrimary = false,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(session?.durationSeconds || 0);

  // Sync when session duration is received from server
  useEffect(() => {
    if (session?.durationSeconds !== undefined) {
      setElapsedSeconds(session.durationSeconds);
    }
  }, [session?.durationSeconds, session?.id]);

  // Live 1-second clock while session is active
  useEffect(() => {
    if (!session || session.status !== 'active') return;

    const timer = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [session?.status, session?.id]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const primaryOnline = session?.primaryConnected ?? false;
  const micOnline = session?.micActive ?? false;
  const sysAudioOnline = session?.systemAudioActive ?? false;
  const isPaused = session?.status === 'paused';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: '12px',
      padding: '10px 16px',
      background: 'rgba(13, 18, 29, 0.88)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
      position: 'sticky',
      top: 0,
      zIndex: 40,
    }}>
      {/* Left: Device & Hardware Health Items (PRD Section 45) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', fontSize: '0.8rem' }}>
        {/* Primary Device */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: primaryOnline ? '#f8fafc' : '#64748b' }}>
          <Laptop size={14} color={primaryOnline ? '#00f2fe' : '#64748b'} />
          <span>Primary:</span>
          <span style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            color: primaryOnline ? '#10b981' : '#64748b',
            fontWeight: 600,
          }}>
            <span className={`status-dot ${primaryOnline ? 'active' : 'offline'}`} />
            {primaryOnline ? 'Connected' : 'Waiting'}
          </span>
        </div>

        {/* Microphone */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: micOnline ? '#f8fafc' : '#64748b' }}>
          <Mic size={14} color={micOnline ? '#10b981' : '#64748b'} />
          <span>Mic:</span>
          <span style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            color: micOnline ? '#10b981' : '#64748b',
            fontWeight: 600,
          }}>
            <span className={`status-dot ${micOnline ? 'active' : 'offline'}`} />
            {micOnline ? 'Active' : 'Muted'}
          </span>
        </div>

        {/* System Audio */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: sysAudioOnline ? '#f8fafc' : '#64748b' }}>
          <Volume2 size={14} color={sysAudioOnline ? '#f59e0b' : '#64748b'} />
          <span>System:</span>
          <span style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            color: sysAudioOnline ? '#f59e0b' : '#64748b',
            fontWeight: 600,
          }}>
            <span className={`status-dot ${sysAudioOnline ? 'active' : 'offline'}`} />
            {sysAudioOnline ? 'Active' : 'Standby'}
          </span>
        </div>

        {/* AI Engine Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#f8fafc' }}>
          <Cpu size={14} color="#a855f7" />
          <span>AI:</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#a855f7', fontWeight: 600 }}>
            <span className="status-dot active" style={{ background: '#a855f7', boxShadow: '0 0 8px #a855f7' }} />
            Ready
          </span>
        </div>

        {/* Network Quality & Latency */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
          <Wifi size={14} color="#10b981" />
          <span>{latencyMs}ms</span>
        </div>
      </div>

      {/* Right: Timer & Session Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: 'rgba(255, 255, 255, 0.05)',
          padding: '4px 10px',
          borderRadius: '8px',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85rem',
          color: isPaused ? '#f59e0b' : '#00f2fe',
        }}>
          <Clock size={13} />
          <span>{formatTime(elapsedSeconds)}</span>
          {isPaused && <span style={{ fontSize: '0.7rem', color: '#f59e0b', textTransform: 'uppercase' }}>(PAUSED)</span>}
        </div>

        {isPrimary && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {isPaused ? (
              <button onClick={onResume} className="btn btn-secondary btn-sm" title="Resume Session">
                <Play size={13} /> Resume
              </button>
            ) : (
              <button onClick={onPause} className="btn btn-secondary btn-sm" title="Pause Session">
                <Pause size={13} /> Pause
              </button>
            )}
            <button onClick={onEnd} className="btn btn-danger btn-sm" title="End Session">
              <PowerOff size={13} /> End
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
