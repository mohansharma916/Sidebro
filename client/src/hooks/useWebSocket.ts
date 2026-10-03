import { useEffect, useRef, useState, useCallback } from 'react';
import { WSMessage, WSEventType, DeviceInfo } from '../types';

export function useWebSocket(onEvent?: (msg: WSMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number>(24);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // Track session details for automatic re-joining upon reconnect
  const activeSessionRef = useRef<{ sessionId?: string; code?: string; device?: DeviceInfo } | null>(null);
  const pendingQueueRef = useRef<string[]>([]);
  const preferProxyRef = useRef<boolean>(false);

  const registerSession = useCallback((sessionId?: string, code?: string, device?: DeviceInfo) => {
    activeSessionRef.current = { sessionId, code, device };
  }, []);

  const connect = useCallback(() => {
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

    try {
      console.log(`[WebSocket] Connecting to ${wsUrl}...`);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WebSocket] Connected successfully!');
        setIsConnected(true);
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);

        // Auto re-join session if registered
        if (activeSessionRef.current) {
          console.log('[WebSocket] Auto-rejoining session:', activeSessionRef.current.sessionId || activeSessionRef.current.code);
          const joinMsg: WSMessage = {
            event: 'session.join',
            sessionId: activeSessionRef.current.sessionId,
            payload: {
              sessionId: activeSessionRef.current.sessionId,
              code: activeSessionRef.current.code,
              device: activeSessionRef.current.device,
            },
          };
          ws.send(JSON.stringify(joinMsg));
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
              sessionId: activeSessionRef.current?.sessionId,
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
            return;
          }

          if (onEventRef.current) {
            onEventRef.current(data);
          }
        } catch (e) {
          console.error('[WebSocket] Message parse error:', e);
        }
      };

      ws.onclose = (event) => {
        console.warn(`[WebSocket] Closed (code: ${event.code}). Scheduling reconnect in 1.5s...`);
        setIsConnected(false);
        wsRef.current = null;
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 1500);
      };

      ws.onerror = (err) => {
        console.warn('[WebSocket] Error, toggling proxy fallback and reconnecting:', err);
        preferProxyRef.current = !preferProxyRef.current;
        try { ws.close(); } catch {}
      };
    } catch (err) {
      console.error('[WebSocket] Init error:', err);
      preferProxyRef.current = !preferProxyRef.current;
      reconnectTimeoutRef.current = setTimeout(connect, 2000);
    }
  }, []);

  const send = useCallback((event: WSEventType, payload: any, sessionId?: string) => {
    // If this is a join event, register session for auto-reconnect
    if (event === 'session.join') {
      activeSessionRef.current = {
        sessionId: payload?.sessionId || sessionId,
        code: payload?.code,
        device: payload?.device,
      };
    }

    const targetSessionId = sessionId || activeSessionRef.current?.sessionId;
    const msg: WSMessage = {
      event,
      sessionId: targetSessionId,
      payload,
    };
    const serialized = JSON.stringify(msg);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(serialized);
    } else {
      pendingQueueRef.current.push(serialized);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { isConnected, latencyMs, send, registerSession };
}
