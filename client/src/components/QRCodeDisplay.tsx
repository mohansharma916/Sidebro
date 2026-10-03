import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Check, ExternalLink, Smartphone, ShieldCheck } from 'lucide-react';
import { DeviceInfo } from '../types';

interface QRCodeDisplayProps {
  sessionCode: string;
  sessionId: string;
  connectedDevices: DeviceInfo[];
  localIp?: string;
}

export const QRCodeDisplay: React.FC<QRCodeDisplayProps> = ({
  sessionCode,
  sessionId,
  connectedDevices,
  localIp,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // Compute pairing URL (works locally or across WiFi network)
  const host = localIp && localIp !== 'localhost' ? localIp : window.location.hostname;
  const port = window.location.port ? `:${window.location.port}` : '';
  const pairingUrl = `${window.location.protocol}//${host}${port}/?join=${sessionCode}`;

  useEffect(() => {
    if (!pairingUrl) return;
    QRCode.toDataURL(pairingUrl, {
      width: 240,
      margin: 1,
      color: {
        dark: '#080b11',
        light: '#ffffff',
      },
    })
      .then(url => setQrDataUrl(url))
      .catch(err => console.error('[QRCode] Error:', err));
  }, [pairingUrl]);

  const copyCode = () => {
    navigator.clipboard.writeText(sessionCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(pairingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const secondScreenDevices = (connectedDevices || []).filter(
    d => d.role === 'SECOND_SCREEN' || d.type === 'MOBILE' || d.type === 'TABLET' || (d.id !== 'primary-capture-device' && d.role !== 'PRIMARY_CAPTURE')
  );

  return (
    <div className="glass-panel" style={{ padding: '24px', textAlign: 'center', maxWidth: '380px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
        <Smartphone size={20} color="#00f2fe" />
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>
          Connect Second Screen
        </h3>
      </div>
      <p style={{ fontSize: '0.84rem', color: '#94a3b8', marginBottom: '18px' }}>
        Scan with your phone, tablet, or another laptop to open the AI workspace.
      </p>

      {/* QR Code Container */}
      <div style={{
        background: '#ffffff',
        padding: '12px',
        borderRadius: '16px',
        display: 'inline-block',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4)',
        marginBottom: '16px',
      }}>
        {qrDataUrl ? (
          <img src={qrDataUrl} alt="Pairing QR Code" style={{ width: '190px', height: '190px', display: 'block' }} />
        ) : (
          <div style={{ width: '190px', height: '190px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
            Generating QR...
          </div>
        )}
      </div>

      {/* 6-Character Session Code Display */}
      <div style={{ marginBottom: '16px' }}>
        <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b' }}>
          Session Code
        </span>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          marginTop: '4px',
        }}>
          <span style={{
            fontSize: '1.8rem',
            fontWeight: 800,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.15em',
            color: '#00f2fe',
            textShadow: '0 0 16px rgba(0, 242, 254, 0.3)',
          }}>
            {sessionCode}
          </span>
          <button
            onClick={copyCode}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              padding: '6px',
              borderRadius: '6px',
              cursor: 'pointer',
              color: copied ? '#10b981' : '#94a3b8',
            }}
            title="Copy Session Code"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button
          onClick={copyUrl}
          className="btn btn-secondary btn-sm"
          style={{ width: '100%' }}
        >
          <Copy size={14} /> Copy Mobile Link
        </button>

        <a
          href={pairingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary btn-sm"
          style={{ width: '100%' }}
        >
          <ExternalLink size={14} /> Open Second Screen (New Tab)
        </a>
      </div>

      {/* Connected Devices status (PRD Section 14, 47) */}
      <div style={{
        marginTop: '18px',
        paddingTop: '14px',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        textAlign: 'left',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '0.76rem', color: '#94a3b8', fontWeight: 600 }}>
            Connected Devices ({secondScreenDevices.length})
          </span>
          <ShieldCheck size={14} color="#10b981" />
        </div>

        {secondScreenDevices.length === 0 ? (
          <p style={{ fontSize: '0.78rem', color: '#64748b', fontStyle: 'italic' }}>
            Waiting for phone or tablet to scan...
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {secondScreenDevices.map(dev => (
              <div
                key={dev.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  borderRadius: '6px',
                  fontSize: '0.76rem',
                }}
              >
                <span style={{ color: '#f8fafc', fontWeight: 500 }}>{dev.name}</span>
                <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="status-dot active" style={{ width: '6px', height: '6px' }} />
                  Live
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
