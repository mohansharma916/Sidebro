import React, { useRef, useEffect, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, X, AlertCircle } from 'lucide-react';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (code: string) => void;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    setHasScanned(false);
    setCameraError(null);
    startCamera();

    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access is not supported in this browser. Please enter the 6-character code manually.');
      }

      // Request back-facing camera on mobile
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true'); // Required for iOS Safari
        await videoRef.current.play();
        startScanLoop();
      }
    } catch (err: any) {
      console.warn('[QRScanner] Camera access notice:', err);
      let msg = 'Could not access camera.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Camera permission was denied. Please allow camera access in browser settings or enter the code manually.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'No camera found on this device.';
      }
      setCameraError(msg);
    }
  };

  const stopCamera = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const startScanLoop = () => {
    let lastScanTime = 0;

    const scanFrame = (timestamp: number) => {
      if (!videoRef.current || !canvasRef.current || hasScanned) return;

      const video = videoRef.current;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        // Scan every 120ms to save battery and maintain responsiveness
        if (timestamp - lastScanTime > 120) {
          lastScanTime = timestamp;
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });

          if (ctx) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'dontInvert',
            });

            if (code && code.data) {
              const rawData = code.data.trim();
              let extractedCode = '';

              // Check if URL with ?join=XXXXXX
              try {
                const url = new URL(rawData);
                const joinParam = url.searchParams.get('join');
                if (joinParam) {
                  extractedCode = joinParam.trim().toUpperCase();
                }
              } catch {
                // Not a full URL, check if pure 6-char alphanumeric code
                const match = rawData.match(/\b([A-Z0-9]{6})\b/i);
                if (match) {
                  extractedCode = match[1].toUpperCase();
                }
              }

              if (extractedCode && extractedCode.length === 6) {
                setHasScanned(true);
                stopCamera();
                onScanSuccess(extractedCode);
                return;
              }
            }
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(scanFrame);
    };

    animFrameRef.current = requestAnimationFrame(scanFrame);
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      backdropFilter: 'blur(10px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px',
    }}>
      <div style={{
        position: 'relative',
        width: '100%',
        maxWidth: '360px',
        backgroundColor: '#070b14',
        borderRadius: '24px',
        border: '1px solid rgba(0, 242, 254, 0.25)',
        overflow: 'hidden',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8)',
        padding: '20px',
        textAlign: 'center',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Camera size={20} color="#00f2fe" />
            <span style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc' }}>
              Scan Pairing QR
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Camera Viewport / Scanning Area */}
        <div style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '1 / 1',
          borderRadius: '16px',
          overflow: 'hidden',
          backgroundColor: '#020408',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          marginBottom: '16px',
        }}>
          {cameraError ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              padding: '24px',
              color: '#f87171',
              fontSize: '0.88rem',
            }}>
              <AlertCircle size={36} style={{ marginBottom: '12px', opacity: 0.8 }} />
              <p>{cameraError}</p>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
              <canvas ref={canvasRef} style={{ display: 'none' }} />

              {/* Holographic Aiming Target */}
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '68%',
                height: '68%',
                border: '2px solid rgba(0, 242, 254, 0.8)',
                borderRadius: '16px',
                boxShadow: '0 0 25px rgba(0, 242, 254, 0.3)',
                pointerEvents: 'none',
              }}>
                {/* Corner Accents */}
                <div style={{ position: 'absolute', top: '-4px', left: '-4px', width: '16px', height: '16px', borderTop: '3px solid #00f2fe', borderLeft: '3px solid #00f2fe' }} />
                <div style={{ position: 'absolute', top: '-4px', right: '-4px', width: '16px', height: '16px', borderTop: '3px solid #00f2fe', borderRight: '3px solid #00f2fe' }} />
                <div style={{ position: 'absolute', bottom: '-4px', left: '-4px', width: '16px', height: '16px', borderBottom: '3px solid #00f2fe', borderLeft: '3px solid #00f2fe' }} />
                <div style={{ position: 'absolute', bottom: '-4px', right: '-4px', width: '16px', height: '16px', borderBottom: '3px solid #00f2fe', borderRight: '3px solid #00f2fe' }} />
              </div>
            </>
          )}
        </div>

        <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '0 0 16px 0', lineHeight: 1.4 }}>
          Point camera at the QR code displayed on your primary computer.
        </p>

        <button
          onClick={onClose}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '12px',
            color: '#cbd5e1',
            fontSize: '0.88rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Cancel & Enter Manually
        </button>
      </div>
    </div>
  );
};
