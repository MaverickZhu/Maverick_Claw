import { useEffect, useRef, useCallback } from 'react';

export interface WSMessage {
  type: 'connect' | 'req' | 'res' | 'event' | 'error';
  id?: string;
  event?: string;
  payload?: unknown;
  error?: string;
  ok?: boolean;
  // Additional fields for different message types
  params?: unknown;
  method?: string;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';

interface PendingRequest {
  resolve: (value: WSMessage) => void;
  reject: (reason: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private messageHandlers = new Map<string, Set<(msg: WSMessage) => void>>();
  private pendingRequests = new Map<string, PendingRequest>();
  private connectionHandlers = new Set<(status: ConnectionStatus) => void>();
  private connectionStatus: ConnectionStatus = 'idle';
  private manualClose = false;
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string) {
    this.url = url;
  }

  private setConnectionStatus(status: ConnectionStatus): void {
    if (this.connectionStatus === status) {
      return;
    }

    this.connectionStatus = status;
    for (const handler of this.connectionHandlers) {
      try {
        handler(status);
      } catch (error) {
        console.error('WebSocket status handler failed:', error);
      }
    }
  }

  onConnectionChange(handler: (status: ConnectionStatus) => void): () => void {
    this.connectionHandlers.add(handler);
    handler(this.connectionStatus);
    return () => {
      this.connectionHandlers.delete(handler);
    };
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private rejectAllPendingRequests(reason: Error): void {
    for (const [, pending] of this.pendingRequests) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      pending.reject(reason);
    }
    this.pendingRequests.clear();
  }

  private sendJson(message: WSMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return;
    }
    throw new Error('WebSocket 未连接');
  }

  connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.setConnectionStatus('connected');
      return Promise.resolve();
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.setConnectionStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    this.connectPromise = new Promise((resolve, reject) => {
      try {
        this.manualClose = false;
        const socket = new WebSocket(this.url);
        this.ws = socket;

        socket.onopen = () => {
          if (this.ws !== socket) return;

          console.log('WebSocket connected');
          this.reconnectAttempts = 0;

          const connectId = this.generateId();
          const connectTimeout = setTimeout(() => {
            if (this.pendingRequests.has(connectId)) {
              this.pendingRequests.delete(connectId);
              this.connectPromise = null;
              this.setConnectionStatus('failed');
              try {
                socket.close(1011, 'Handshake timeout');
              } catch {
                // noop
              }
              reject(new Error('连接握手超时'));
            }
          }, 10000);

          this.pendingRequests.set(connectId, {
            resolve: (msg) => {
              clearTimeout(connectTimeout);
              this.connectPromise = null;
              if (msg.ok) {
                this.setConnectionStatus('connected');
                resolve();
              } else {
                this.setConnectionStatus('failed');
                reject(new Error(typeof msg.error === 'string' ? msg.error : '连接握手失败'));
              }
            },
            reject: (reason) => {
              clearTimeout(connectTimeout);
              this.connectPromise = null;
              this.setConnectionStatus('failed');
              reject(reason);
            },
            timeoutId: connectTimeout,
          });

          try {
            this.sendJson({
              type: 'connect',
              id: connectId,
              params: {
                clientType: 'web',
                clientVersion: '0.1.0',
                deviceId: this.getDeviceId(),
                token: this.getToken(),
              },
            });
          } catch (error) {
            this.pendingRequests.delete(connectId);
            clearTimeout(connectTimeout);
            this.connectPromise = null;
            reject(error instanceof Error ? error : new Error('发送握手消息失败'));
          }
        };

        socket.onmessage = (event) => {
          if (this.ws !== socket) return;
          try {
            const rawData = typeof event.data === 'string' ? event.data : String(event.data);
            const message: WSMessage = JSON.parse(rawData);
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        socket.onclose = () => {
          if (this.ws !== socket) return;

          this.ws = null;
          this.connectPromise = null;
          this.rejectAllPendingRequests(new Error('WebSocket 已断开'));
          console.log('WebSocket disconnected');
          this.setConnectionStatus('disconnected');

          if (!this.manualClose) {
            this.attemptReconnect();
          }
        };

        socket.onerror = (error) => {
          if (this.ws !== socket) return;

          this.connectPromise = null;
          console.error('WebSocket error:', error);
          if (socket.readyState !== WebSocket.OPEN) {
            reject(new Error('WebSocket 连接失败'));
          }
        };
      } catch (error) {
        this.connectPromise = null;
        this.setConnectionStatus('failed');
        reject(error instanceof Error ? error : new Error('WebSocket 初始化失败'));
      }
    });

    return this.connectPromise;
  }

  disconnect(): void {
    this.manualClose = true;
    this.clearReconnectTimer();
    this.connectPromise = null;
    this.rejectAllPendingRequests(new Error('WebSocket 手动断开'));

    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.close();
    }
    this.setConnectionStatus('disconnected');
  }

  send(message: WSMessage): void {
    try {
      this.sendJson(message);
    } catch (error) {
      console.warn('WebSocket not connected');
      if (error instanceof Error) {
        console.debug(error.message);
      }
    }
  }

  request(method: string, params?: unknown): Promise<WSMessage> {
    return new Promise((resolve, reject) => {
      const sendRequest = () => {
        const id = this.generateId();
        const timeoutId = setTimeout(() => {
          if (this.pendingRequests.has(id)) {
            this.pendingRequests.delete(id);
            reject(new Error('Request timeout'));
          }
        }, 30000);

        this.pendingRequests.set(id, { resolve, reject, timeoutId });

        try {
          this.sendJson({
            type: 'req',
            id,
            method,
            params,
          });
        } catch (error) {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(id);
          reject(error instanceof Error ? error : new Error('发送请求失败'));
        }
      };

      if (this.ws?.readyState === WebSocket.OPEN) {
        sendRequest();
        return;
      }

      this.connect().then(sendRequest).catch(reject);
    });
  }

  onEvent(event: string, handler: (msg: WSMessage) => void): () => void {
    const handlers = this.messageHandlers.get(event) ?? new Set<(msg: WSMessage) => void>();
    handlers.add(handler);
    this.messageHandlers.set(event, handlers);
    return () => {
      const currentHandlers = this.messageHandlers.get(event);
      if (!currentHandlers) {
        return;
      }
      currentHandlers.delete(handler);
      if (currentHandlers.size === 0) {
        this.messageHandlers.delete(event);
      }
    };
  }

  private handleMessage(message: WSMessage): void {
    // Handle responses to pending requests
    if (
      (message.type === 'res' || message.type === 'connect') &&
      message.id &&
      this.pendingRequests.has(message.id)
    ) {
      const pending = this.pendingRequests.get(message.id)!;
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      this.pendingRequests.delete(message.id);
      pending.resolve(message);
      return;
    }

    // Handle events
    if (message.type === 'event' && message.event) {
      const handlers = this.messageHandlers.get(message.event);
      if (handlers && handlers.size > 0) {
        for (const handler of handlers) {
          handler(message);
        }
      }
    }
  }

  private attemptReconnect(): void {
    if (this.manualClose) {
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }
    if (this.connectPromise) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.setConnectionStatus('failed');
      return;
    }

    this.reconnectAttempts++;
    const backoffDelay = Math.min(this.reconnectDelay * 2 ** (this.reconnectAttempts - 1), 15000);
    const jitter = Math.floor(Math.random() * 300);
    const delay = backoffDelay + jitter;
    
    console.log(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts})`);

    this.setConnectionStatus('reconnecting');
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(console.error);
    }, delay);
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private getDeviceId(): string {
    let deviceId = localStorage.getItem('maverick_device_id');
    if (!deviceId) {
      deviceId = this.generateId();
      localStorage.setItem('maverick_device_id', deviceId);
    }
    return deviceId;
  }

  private getToken(): string | undefined {
    const token = localStorage.getItem('maverick_auth_token');
    return token || undefined;
  }
}

// Singleton instance
let globalClient: WebSocketClient | null = null;

export function getWebSocketClient(): WebSocketClient {
  if (!globalClient) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    globalClient = new WebSocketClient(`${protocol}//${host}/ws`);
  }
  return globalClient;
}

// React hook for WebSocket
export function useWebSocket() {
  const clientRef = useRef(getWebSocketClient());

  useEffect(() => {
    const client = clientRef.current;
    client.connect().catch(console.error);

    return () => {
      client.disconnect();
    };
  }, []);

  const request = useCallback((method: string, params?: unknown) => {
    return clientRef.current.request(method, params);
  }, []);

  const onEvent = useCallback((event: string, handler: (msg: WSMessage) => void) => {
    return clientRef.current.onEvent(event, handler);
  }, []);

  return { request, onEvent };
}
