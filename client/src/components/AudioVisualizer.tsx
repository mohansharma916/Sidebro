import React, { useRef, useEffect } from 'react';

interface AudioVisualizerProps {
  micVolume: number;
  systemVolume: number;
  isMicActive: boolean;
  isSystemAudioActive: boolean;
  vadActive: boolean;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  micVolume,
  systemVolume,
  isMicActive,
  isSystemAudioActive,
  vadActive,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let phase = 0;

    const render = () => {
      phase += 0.05;
      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      // Background subtle grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      // Draw Mic Wave (Cyan/Blue)
      if (isMicActive) {
        ctx.beginPath();
        ctx.strokeStyle = '#00f2fe';
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(0, 242, 254, 0.6)';

        const micAmp = Math.max(8, micVolume * (height / 2.2));
        for (let x = 0; x < width; x++) {
          const y = height / 2 + Math.sin(x * 0.04 + phase) * micAmp * Math.sin(x / width * Math.PI);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Draw System Audio Wave (Amber/Purple)
      if (isSystemAudioActive) {
        ctx.beginPath();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.shadowBlur = 8;
        ctx.shadowColor = 'rgba(245, 158, 11, 0.5)';

        const sysAmp = Math.max(6, systemVolume * (height / 2.5));
        for (let x = 0; x < width; x++) {
          const y = height / 2 + Math.cos(x * 0.035 - phase) * sysAmp * Math.sin(x / width * Math.PI);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Reset shadow
      ctx.shadowBlur = 0;
      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [micVolume, systemVolume, isMicActive, isSystemAudioActive]);

  return (
    <div style={{ position: 'relative', width: '100%', borderRadius: '12px', overflow: 'hidden', background: '#05070c', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
      <canvas
        ref={canvasRef}
        width={400}
        height={80}
        style={{ width: '100%', height: '80px', display: 'block' }}
      />
      <div style={{
        position: 'absolute',
        bottom: '6px',
        left: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        fontSize: '0.72rem',
        color: '#94a3b8',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isMicActive ? '#00f2fe' : '#475569' }} />
          Mic (You)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isSystemAudioActive ? '#f59e0b' : '#475569' }} />
          System (Other)
        </span>
        {vadActive && (
          <span style={{ color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className="status-dot active" style={{ width: '6px', height: '6px' }} />
            VAD Speech
          </span>
        )}
      </div>
    </div>
  );
};
