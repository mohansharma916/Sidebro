import { useState, useRef, useEffect, useCallback } from 'react';

export interface AudioCaptureState {
  isMicActive: boolean;
  isSystemAudioActive: boolean;
  micVolume: number;
  systemVolume: number;
  vadActive: boolean;
  recognitionActive: boolean;
  isTranscribing: boolean;
  error: string | null;
}

function getOptimalAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {}
  }
  return 'audio/webm';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Continuous Segment Recorder that records audio in sequential 2.5-second chunks.
 * Calling rec.stop() guarantees every single slice has a complete, valid container
 * header (EBML/Opus/WAV), preventing headerless chunk errors in Whisper.
 */
class ContinuousSegmentRecorder {
  private stream: MediaStream;
  private speaker: 'YOU' | 'OTHER';
  private mimeType: string;
  private onSlice: (speaker: 'YOU' | 'OTHER', base64: string, mimeType: string) => void;
  private isRunning: boolean = false;
  private currentRecorder: MediaRecorder | null = null;
  private timer: any = null;
  private monitorTimer: any = null;
  private intervalMs: number = 2500; // 2.5 second slice for responsive transcription and continuous sentences
  private getVolume: () => number;
  private maxVolInSlice: number = 0;
  private speechFramesInSlice: number = 0;

  constructor(
    stream: MediaStream,
    speaker: 'YOU' | 'OTHER',
    getVolume: () => number,
    onSlice: (speaker: 'YOU' | 'OTHER', base64: string, mimeType: string) => void
  ) {
    this.stream = stream;
    this.speaker = speaker;
    this.mimeType = getOptimalAudioMimeType();
    this.getVolume = getVolume;
    this.onSlice = onSlice;
  }

  public start() {
    this.isRunning = true;
    this.recordNextSegment();
  }

  private recordNextSegment() {
    if (!this.isRunning || !this.stream.active) return;

    try {
      const rec = new MediaRecorder(this.stream, { mimeType: this.mimeType });
      this.currentRecorder = rec;

      this.maxVolInSlice = 0;
      this.speechFramesInSlice = 0;

      // Monitor audio energy periodically across the 3.5s segment
      if (this.monitorTimer) clearInterval(this.monitorTimer);
      this.monitorTimer = setInterval(() => {
        const vol = this.getVolume();
        if (vol > this.maxVolInSlice) {
          this.maxVolInSlice = vol;
        }
        // Human speech typically exceeds 0.024 amplitude; ambient air/breathing stays below 0.018
        if (vol > 0.024) {
          this.speechFramesInSlice++;
        }
      }, 60);

      rec.ondataavailable = async (e) => {
        if (this.monitorTimer) {
          clearInterval(this.monitorTimer);
          this.monitorTimer = null;
        }

        // True speech requires sustained vocal sound (at least 3 sample ticks ~= 180ms)
        // or a noticeable vocal peak (> 0.048)
        const hasAudibleSpeech = this.speechFramesInSlice >= 3 || this.maxVolInSlice >= 0.048;

        if (e.data && e.data.size > 800 && hasAudibleSpeech) {
          try {
            const base64 = await blobToBase64(e.data);
            if (base64) {
              this.onSlice(this.speaker, base64, this.mimeType);
            }
          } catch (err) {
            console.warn(`[SegmentRecorder] Base64 encoding error:`, err);
          }
        }
      };

      rec.onstop = () => {
        if (this.monitorTimer) {
          clearInterval(this.monitorTimer);
          this.monitorTimer = null;
        }
        if (this.isRunning && this.stream.active) {
          // Immediately cycle to the next recording segment
          this.recordNextSegment();
        }
      };

      rec.onerror = (e) => {
        if (this.monitorTimer) {
          clearInterval(this.monitorTimer);
          this.monitorTimer = null;
        }
        console.warn(`[SegmentRecorder] Recorder error on ${this.speaker}:`, e);
      };

      rec.start();

      // Stop recorder after interval to flush a complete standalone file
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (rec.state === 'recording') {
          try {
            rec.stop();
          } catch {}
        }
      }, this.intervalMs);
    } catch (err) {
      if (this.monitorTimer) {
        clearInterval(this.monitorTimer);
        this.monitorTimer = null;
      }
      console.warn(`[SegmentRecorder] Failed to start recorder:`, err);
      if (this.isRunning) {
        this.timer = setTimeout(() => this.recordNextSegment(), 1000);
      }
    }
  }

  public pause() {
    this.isRunning = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    if (this.currentRecorder && this.currentRecorder.state !== 'inactive') {
      try {
        this.currentRecorder.stop();
      } catch {}
    }
  }

  public resume() {
    if (!this.isRunning && this.stream && this.stream.active) {
      this.isRunning = true;
      this.recordNextSegment();
    }
  }

  public stop() {
    this.isRunning = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    if (this.currentRecorder && this.currentRecorder.state !== 'inactive') {
      try {
        this.currentRecorder.stop();
      } catch {}
    }
    this.currentRecorder = null;
  }
}

export function useAudioCapture(
  onTranscriptChunk?: (speaker: 'YOU' | 'OTHER', text: string, isFinal: boolean) => void,
  onAudioSlice?: (speaker: 'YOU' | 'OTHER', audioBase64: string, mimeType: string) => void
) {
  const [state, setState] = useState<AudioCaptureState>({
    isMicActive: false,
    isSystemAudioActive: false,
    micVolume: 0,
    systemVolume: 0,
    vadActive: false,
    recognitionActive: false,
    isTranscribing: false,
    error: null,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const systemAnalyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);

  const micRecorderRef = useRef<ContinuousSegmentRecorder | null>(null);
  const sysRecorderRef = useRef<ContinuousSegmentRecorder | null>(null);

  const micVolumeRef = useRef<number>(0);
  const sysVolumeRef = useRef<number>(0);

  const onTranscriptRef = useRef(onTranscriptChunk);
  onTranscriptRef.current = onTranscriptChunk;

  const onAudioSliceRef = useRef(onAudioSlice);
  onAudioSliceRef.current = onAudioSlice;

  // Track if Web Speech API is actively emitting transcripts for YOU
  const webSpeechWorkingRef = useRef<boolean>(false);

  // Initialize Audio Context safely
  const ensureAudioContext = () => {
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  };

  // Start Microphone (Candidate Audio - YOU)
  const startMicrophone = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        console.warn('[AudioCapture] getUserMedia not available in this context');
        setState(prev => ({ ...prev, isMicActive: true, error: null }));
        return;
      }

      const ctx = ensureAudioContext();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      micStreamRef.current = stream;

      // 1. Analyser for waveform visualizer with highpass filter to eliminate sub-bass rumble/air (< 85Hz)
      const source = ctx.createMediaStreamSource(stream);
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 85;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(highpass);
      highpass.connect(analyser);
      micAnalyserRef.current = analyser;

      // 2. Start Continuous Segment Audio Slicer for cloud transcription
      const rec = new ContinuousSegmentRecorder(
        stream,
        'YOU',
        () => micVolumeRef.current,
        (speaker, base64, mimeType) => {
          // If Web Speech API is already transcribing the candidate locally, suppress duplicate cloud calls
          if (webSpeechWorkingRef.current) return;
          if (onAudioSliceRef.current) {
            onAudioSliceRef.current(speaker, base64, mimeType);
          }
        }
      );
      rec.start();
      micRecorderRef.current = rec;

      setState(prev => ({ ...prev, isMicActive: true, error: null }));

      // 3. Start Web Speech API in Chrome for real-time candidate feedback
      initSpeechRecognition();
    } catch (err: any) {
      console.warn('[AudioCapture] Mic capture notice:', err);
      setState(prev => ({
        ...prev,
        isMicActive: true,
        error: 'Microphone permission denied or not available. Running in simulated audio mode.',
      }));
    }
  }, []);

  // Stop Microphone
  const stopMicrophone = useCallback(() => {
    if (micRecorderRef.current) {
      micRecorderRef.current.stop();
      micRecorderRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }
    micAnalyserRef.current = null;
    stopSpeechRecognition();
    setState(prev => ({ ...prev, isMicActive: false }));
  }, []);

  // Start System Audio capture (Interviewer Audio - OTHER via Zoom/Meet/Teams)
  const startSystemAudio = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
        console.warn('[AudioCapture] getDisplayMedia not available in this context, using standby');
        setState(prev => ({ ...prev, isSystemAudioActive: true }));
        return;
      }

      const ctx = ensureAudioContext();
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        throw new Error('No system audio track shared. Please check "Share tab/system audio".');
      }

      systemStreamRef.current = stream;

      // 1. Analyser for waveform visualizer with highpass filter
      const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 85;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(highpass);
      highpass.connect(analyser);
      systemAnalyserRef.current = analyser;

      // 2. Continuous Segment Audio Slicer for Interviewer Speech (OTHER)
      const rec = new ContinuousSegmentRecorder(
        new MediaStream([audioTrack]),
        'OTHER',
        () => sysVolumeRef.current,
        (speaker, base64, mimeType) => {
          if (onAudioSliceRef.current) {
            onAudioSliceRef.current(speaker, base64, mimeType);
          }
        }
      );
      rec.start();
      sysRecorderRef.current = rec;

      setState(prev => ({ ...prev, isSystemAudioActive: true }));
    } catch (err: any) {
      console.warn('[AudioCapture] System audio capture note:', err.message);
      setState(prev => ({ ...prev, isSystemAudioActive: true }));
    }
  }, []);

  // Stop System Audio
  const stopSystemAudio = useCallback(() => {
    if (sysRecorderRef.current) {
      sysRecorderRef.current.stop();
      sysRecorderRef.current = null;
    }
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach(t => t.stop());
      systemStreamRef.current = null;
    }
    systemAnalyserRef.current = null;
    setState(prev => ({ ...prev, isSystemAudioActive: false }));
  }, []);

  // Web Speech API Continuous Recognition with error circuit breaker for Electron
  const errorCountRef = useRef<number>(0);
  const isElectronRef = useRef<boolean>(
    typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent)
  );

  const initSpeechRecognition = () => {
    if (isElectronRef.current) {
      console.log('[AudioCapture] Running in Electron desktop shell. Voice audio is monitored via continuous Whisper STT.');
      webSpeechWorkingRef.current = false;
      setState(prev => ({ ...prev, recognitionActive: false }));
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.log('[AudioCapture] Web Speech API not supported in this browser; using continuous Whisper engine.');
      webSpeechWorkingRef.current = false;
      return;
    }

    try {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';

      rec.onstart = () => {
        errorCountRef.current = 0;
        webSpeechWorkingRef.current = true;
        setState(prev => ({ ...prev, recognitionActive: true }));
      };

      rec.onresult = (event: any) => {
        errorCountRef.current = 0;
        webSpeechWorkingRef.current = true;
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          const transcript = item[0].transcript;
          const isFinal = item.isFinal;
          if (transcript.trim() && onTranscriptRef.current) {
            onTranscriptRef.current('YOU', transcript.trim(), isFinal);
          }
        }
      };

      rec.onerror = (e: any) => {
        errorCountRef.current += 1;
        if (e.error !== 'no-speech') {
          console.warn('[SpeechRec] Notice:', e.error);
        }
        if (e.error === 'service-not-allowed' || e.error === 'network' || errorCountRef.current >= 3) {
          webSpeechWorkingRef.current = false;
          try { rec.stop(); } catch {}
          recognitionRef.current = null;
          setState(prev => ({ ...prev, recognitionActive: false }));
        }
      };

      rec.onend = () => {
        if (micStreamRef.current && errorCountRef.current < 3) {
          try {
            rec.start();
          } catch {
            webSpeechWorkingRef.current = false;
            setState(prev => ({ ...prev, recognitionActive: false }));
          }
        } else {
          webSpeechWorkingRef.current = false;
          setState(prev => ({ ...prev, recognitionActive: false }));
        }
      };

      rec.start();
      recognitionRef.current = rec;
    } catch (e) {
      console.warn('[SpeechRec] Could not initialize:', e);
      webSpeechWorkingRef.current = false;
      setState(prev => ({ ...prev, recognitionActive: false }));
    }
  };

  const stopSpeechRecognition = () => {
    webSpeechWorkingRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
      setState(prev => ({ ...prev, recognitionActive: false }));
    }
  };

  // Real-time Audio Level & VAD Monitor Loop
  useEffect(() => {
    const updateVolumes = () => {
      let micVol = 0;
      let sysVol = 0;

      if (micAnalyserRef.current) {
        const data = new Uint8Array(micAnalyserRef.current.frequencyBinCount);
        micAnalyserRef.current.getByteFrequencyData(data);
        const sum = data.reduce((a, b) => a + b, 0);
        micVol = sum / data.length / 255;
      }

      if (systemAnalyserRef.current) {
        const data = new Uint8Array(systemAnalyserRef.current.frequencyBinCount);
        systemAnalyserRef.current.getByteFrequencyData(data);
        const sum = data.reduce((a, b) => a + b, 0);
        sysVol = sum / data.length / 255;
      }

      micVolumeRef.current = micVol;
      sysVolumeRef.current = sysVol;

      // Real human speech is > 0.024; room tone/breathing/air noise is < 0.018
      const vad = micVol > 0.024 || sysVol > 0.024;

      setState(prev => ({
        ...prev,
        micVolume: micVol,
        systemVolume: sysVol,
        vadActive: vad,
      }));

      animFrameRef.current = requestAnimationFrame(updateVolumes);
    };

    animFrameRef.current = requestAnimationFrame(updateVolumes);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // Pause audio capture without dropping device stream handles
  const pauseAudioCapture = useCallback(() => {
    if (micRecorderRef.current) micRecorderRef.current.pause();
    if (sysRecorderRef.current) sysRecorderRef.current.pause();
    stopSpeechRecognition();
  }, []);

  // Resume audio capture
  const resumeAudioCapture = useCallback(() => {
    if (micRecorderRef.current) micRecorderRef.current.resume();
    if (sysRecorderRef.current) sysRecorderRef.current.resume();
    initSpeechRecognition();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMicrophone();
      stopSystemAudio();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, [stopMicrophone, stopSystemAudio]);

  return {
    state,
    startMicrophone,
    stopMicrophone,
    startSystemAudio,
    stopSystemAudio,
    pauseAudioCapture,
    resumeAudioCapture,
    micAnalyser: micAnalyserRef.current,
    systemAnalyser: systemAnalyserRef.current,
  };
}
