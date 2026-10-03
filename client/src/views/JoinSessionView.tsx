import React, { useState, useEffect } from 'react';
import { Smartphone, Laptop, Tablet, ArrowRight, ShieldCheck, Zap, Camera, QrCode } from 'lucide-react';
import { DeviceInfo, DeviceType } from '../types';
import { QRScannerModal } from '../components/QRScannerModal';

interface JoinSessionViewProps {
  onJoinSession: (code: string, device: DeviceInfo) => void;
  initialCode?: string;
}

export const JoinSessionView: React.FC<JoinSessionViewProps> = ({
  onJoinSession,
  initialCode = '',
}) => {
  const [code, setCode] = useState(initialCode);
  const [deviceName, setDeviceName] = useState('');
  const [deviceType, setDeviceType] = useState<DeviceType>('MOBILE');
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);

  useEffect(() => {
    // Detect device type heuristics
    const ua = navigator.userAgent.toLowerCase();
    let defaultType: DeviceType = 'MOBILE';
    let defaultName = 'Mobile Device';

    if (ua.includes('ipad') || (ua.includes('macintosh') && 'ontouchend' in document)) {
      defaultType = 'TABLET';
      defaultName = 'iPad Pro';
    } else if (ua.includes('iphone')) {
      defaultType = 'MOBILE';
      defaultName = 'iPhone (Safari)';
    } else if (ua.includes('android')) {
      defaultType = 'MOBILE';
      defaultName = 'Android Phone';
    } else {
      defaultType = 'WEB';
      defaultName = 'Second Laptop (Web)';
    }

    setDeviceType(defaultType);
    setDeviceName(defaultName);

    if (initialCode) {
      const clean = initialCode.toUpperCase().trim();
      setCode(clean);
      // Auto-join if 6 characters provided (e.g. from QR scan)
      if (clean.length === 6) {
        doJoin(clean, defaultName, defaultType);
      }
    }
  }, [initialCode]);

  const doJoin = async (targetCode: string, name: string, type: DeviceType) => {
    if (isConnecting) return;
    setErrorMessage(null);
    setIsConnecting(true);

    try {
      const device: DeviceInfo = {
        id: `dev-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        name: name.trim() || 'Second Screen',
        type,
        role: 'SECOND_SCREEN',
        platform: navigator.platform,
        connectedAt: Date.now(),
        lastSeen: Date.now(),
      };

      await onJoinSession(targetCode.trim().toUpperCase(), device);
    } catch (err: any) {
      setErrorMessage(err.message || 'Session not found. Please check the 6-character code.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleScanSuccess = (scannedCode: string) => {
    setCode(scannedCode);
    setShowScanner(false);
    doJoin(scannedCode, deviceName, deviceType);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    doJoin(code, deviceName, deviceType);
  };

  return (
    <div style={{
      maxWidth: '440px',
      margin: '48px auto',
      padding: '0 20px',
    }}>
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <div style={{
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'rgba(0, 242, 254, 0.1)',
          border: '1px solid rgba(0, 242, 254, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
          color: '#00f2fe',
        }}>
          <Smartphone size={26} />
        </div>
        <h1 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
          Connect Second Screen
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '0.88rem', marginTop: '6px' }}>
          Scan the QR code on your primary desktop or enter the 6-character code below.
        </p>
      </div>

      <div className="glass-panel" style={{ padding: '28px' }}>
        {/* In-App Camera QR Code Scanner Button */}
        <div style={{ marginBottom: '22px' }}>
          <button
            type="button"
            onClick={() => setShowScanner(true)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              padding: '14px',
              background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.12), rgba(79, 70, 229, 0.12))',
              border: '1px solid rgba(0, 242, 254, 0.4)',
              borderRadius: '14px',
              color: '#00f2fe',
              fontWeight: 700,
              fontSize: '0.94rem',
              cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(0, 242, 254, 0.1)',
              transition: 'all 0.2s ease',
            }}
          >
            <Camera size={18} />
            <span>Scan QR Code with Camera</span>
          </button>
          <p style={{
            fontSize: '0.74rem',
            color: '#64748b',
            textAlign: 'center',
            marginTop: '8px',
          }}>
            Tip: You can also use your phone's default Camera app to scan
          </p>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '20px',
        }}>
          <div style={{ flex: 1, height: '1px', background: 'rgba(255, 255, 255, 0.08)' }} />
          <span style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>OR ENTER MANUALLY</span>
          <div style={{ flex: 1, height: '1px', background: 'rgba(255, 255, 255, 0.08)' }} />
        </div>

        <form onSubmit={handleSubmit}>
          {/* 6-Character Session Code Input (PRD Section 12) */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '8px' }}>
              6-CHARACTER SESSION CODE
            </label>
            <input
              type="text"
              maxLength={6}
              placeholder="A7X9KP"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(0, 242, 254, 0.4)',
                borderRadius: '12px',
                padding: '14px',
                textAlign: 'center',
                fontSize: '1.8rem',
                fontWeight: 800,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.2em',
                color: '#00f2fe',
                outline: 'none',
                textTransform: 'uppercase',
                boxShadow: '0 0 20px rgba(0, 242, 254, 0.15)',
              }}
              autoFocus
            />
          </div>

          {/* Device Label */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '8px' }}>
              DEVICE NAME
            </label>
            <input
              type="text"
              value={deviceName}
              onChange={e => setDeviceName(e.target.value)}
              placeholder="e.g. iPhone 15 Pro, iPad"
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                padding: '10px 14px',
                color: '#f8fafc',
                fontSize: '0.88rem',
                outline: 'none',
              }}
            />
          </div>

          {/* Error Message Alert */}
          {errorMessage && (
            <div style={{
              background: 'rgba(244, 63, 94, 0.15)',
              border: '1px solid rgba(244, 63, 94, 0.35)',
              borderRadius: '8px',
              padding: '10px 14px',
              color: '#fda4af',
              fontSize: '0.82rem',
              marginBottom: '16px',
              textAlign: 'center',
            }}>
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={code.trim().length < 4 || isConnecting}
            className="btn btn-primary"
            style={{
              width: '100%',
              padding: '14px',
              fontSize: '1rem',
              fontWeight: 700,
              opacity: (code.trim().length >= 4 && !isConnecting) ? 1 : 0.5,
            }}
          >
            {isConnecting ? 'Connecting to Session...' : 'Connect to Session'} <ArrowRight size={16} />
          </button>
        </form>

        <div style={{
          marginTop: '20px',
          paddingTop: '16px',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          color: '#64748b',
          fontSize: '0.74rem',
        }}>
          <ShieldCheck size={14} color="#10b981" />
          <span>Encrypted WebSocket • Zero permanent audio storage</span>
        </div>
      </div>

      {/* Camera QR Scanner Modal */}
      <QRScannerModal
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScanSuccess={handleScanSuccess}
      />
    </div>
  );
};
