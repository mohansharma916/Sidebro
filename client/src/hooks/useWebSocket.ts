import { useEffect, useRef, useState, useCallback } from 'react';
import { WSMessage, WSEventType, DeviceInfo } from '../types';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

interface ActiveSession {
  sessionId?: string;
  token?: string;
  code?: string;
  device?: DeviceInfo;
}

export function useWebSocket(onEvent?: (msg: WSMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number>(24);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const disposedRef = useRef(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // Session credentials for automatic re-joining upon reconnect
  const activeSessionRef = useRef<ActiveSession | null>(null);
  const pendingQueueRef = useRef<string[]>([]);
  const preferProxyRef = useRef<boolean>(false);

  const registerSession = useCallback((sessionId?: string, code?: string, device?: DeviceInfo, token?: string) => {
    activeSessionRef.current = { sessionId, code, device, token };
  }, []);

  const buildJoinMessage = (s: ActiveSession): WSMessage => ({
    event: 'session.join',
    sessionId: s.sessionId,
    // Prefer the token (works after the pairing code expires); fall back to the code.
    payload: s.sessionId && s.token
      ? { sessionId: s.sessionId, token: s.token, device: s.device }
      : { code: s.code, device: s.device },
  });

  const connect = useCallback(() => {
    if (disposedRef.current) return;
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const isHttps = window.location.protocol === 'https:';
    const protocol = isHttps ? 'wss:' : 'ws:';

    // Resolve hostname safely (prefer IPv4 127.0.0.1 over localhost to prevent macOS IPv6 ECONNREFUSED)
    let host = window.location.hostname;
    if (!host || host === 'localhost' || host === '0.0.0.0') {
      host = '127.0.0.1';
    }

    let wsUrl: string;
    if (window.location.protocol === 'file:') {
      wsUrl = 'ws://127.0.0.1:3001/ws';
    } else if (window.location.port === '5173') {
      // Toggle between direct port 3001 and Vite proxy /ws if one fails
      wsUrl = preferProxyRef.current
        ? `${protocol}//${window.location.host}/ws`
        : `${protocol}//${host}:3001/ws`;
    } else {
      wsUrl = `${protocol}//${window.location.host}/ws`;
    }

    const scheduleReconnect = () => {
      if (disposedRef.current) return;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttemptsRef.current);
      reconnectAttemptsRef.current++;
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);

        // Auto re-join session if registered (this is the only place joins are sent while offline)
        if (activeSessionRef.current) {
          ws.send(JSON.stringify(buildJoinMessage(activeSessionRef.current)));
        }

        // Flush any queued messages
        while (pendingQueueRef.current.length > 0) {
          const queued = pendingQueueRef.current.shift();
          if (queued && ws.readyState === WebSocket.OPEN) {
            ws.send(queued);
          }
        }

        // Heartbeat ping over the wire (keeps mobile Safari/Chrome alive and calculates real latency)
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            const pingMsg: WSMessage = {
              event: 'ping',
              payload: { time: Date.now() },
            };
            ws.send(JSON.stringify(pingMsg));
          }
        }, 4000);
      };

      ws.onmessage = (event) => {
        try {
          const data: WSMessage = JSON.parse(event.data);
          if (data.event === 'pong' && data.payload?.time) {
            const roundTrip = Date.now() - data.payload.time;
            setLatencyMs(Math.max(4, roundTrip));
          }

          if (onEventRef.current) {
            onEventRef.current(data);
          }
        } catch (e) {
          console.error('[WebSocket] Message parse error:', e);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (wsRef.current === ws) wsRef.current = null;
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        scheduleReconnect();
      };

      ws.onerror = () => {
        preferProxyRef.current = !preferProxyRef.current;
        try { ws.close(); } catch {}
      };
    } catch (err) {
      console.error('[WebSocket] Init error:', err);
      preferProxyRef.current = !preferProxyRef.current;
      scheduleReconnect();
    }
  }, []);

  const send = useCallback((event: WSEventType, payload: any, sessionId?: string) => {
    const isOpen = wsRef.current?.readyState === WebSocket.OPEN;

    if (event === 'session.join') {
      // Remember credentials; if the socket is down, onopen will send the join exactly once.
      activeSessionRef.current = {
        sessionId: payload?.sessionId || sessionId,
        token: payload?.token,
        code: payload?.code,
        device: payload?.device,
      };
      if (!isOpen) return;
    }

    const msg: WSMessage = {
      event,
      sessionId: sessionId || activeSessionRef.current?.sessionId,
      payload,
    };
    const serialized = JSON.stringify(msg);

    if (isOpen) {
      wsRef.current!.send(serialized);
    } else {
      pendingQueueRef.current.push(serialized);
    }
  }, []);

  /** True while the socket is open (synchronous check for callers that need a REST fallback). */
  const isOpen = useCallback(() => wsRef.current?.readyState === WebSocket.OPEN, []);

  useEffect(() => {
    disposedRef.current = false;
    connect();
    return () => {
      disposedRef.current = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { isConnected, latencyMs, send, registerSession, isOpen };
}
