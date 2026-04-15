import { Card, Input, Button, List, Avatar, Space, Select, Typography, Spin, Badge } from 'antd';
import { SendOutlined, PlusOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useChatStore, type RemoteMessageSnapshot, type RemoteSessionSnapshot } from '../stores/chat';
import { getWebSocketClient, type ConnectionStatus, type WSMessage } from '../api/websocket';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { z } from 'zod';
import type {
  ChatChunkEventPayload,
  ChatCompleteEventPayload,
  ChatErrorEventPayload,
} from '@maverick-claw/shared';

const { TextArea } = Input;
const { Text } = Typography;

function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a({ href, children }) {
          return (
            <a href={href} target="_blank" rel="noreferrer" style={{ color: '#1677ff' }}>
              {children}
            </a>
          );
        },
        code(props) {
          const { className, children } = props;
          const match = /language-(\w+)/.exec(className || '');
          const code = String(children).replace(/\n$/, '');

          if (match) {
            return (
              <SyntaxHighlighter
                language={match[1]}
                style={oneDark}
                customStyle={{ borderRadius: 8, margin: '8px 0', fontSize: 12 }}
              >
                {code}
              </SyntaxHighlighter>
            );
          }

          return (
            <code
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: 'rgba(0,0,0,0.08)',
              }}
            >
              {children}
            </code>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  enabled: boolean;
}

interface ModelsResponse {
  models?: ModelInfo[];
  defaultModel?: string;
}

const ModelInfoSchema: z.ZodType<ModelInfo> = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  enabled: z.boolean(),
});

const ModelsResponseSchema: z.ZodType<ModelsResponse> = z.object({
  models: z.array(ModelInfoSchema).optional(),
  defaultModel: z.string().optional(),
});

const RemoteSessionSnapshotSchema: z.ZodType<RemoteSessionSnapshot> = z.object({
  id: z.string(),
  title: z.string(),
  modelId: z.string().optional(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
});

const RemoteMessageSnapshotSchema: z.ZodType<RemoteMessageSnapshot> = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  createdAt: z.union([z.string(), z.date()]),
});

const SessionListResponsePayloadSchema = z.object({
  sessions: z.array(RemoteSessionSnapshotSchema).default([]),
});

const SessionMessagesResponsePayloadSchema = z.object({
  messages: z.array(RemoteMessageSnapshotSchema).default([]),
});

const ChatChunkEventPayloadSchema: z.ZodType<ChatChunkEventPayload> = z.object({
  content: z.string(),
  done: z.boolean(),
  sessionId: z.string().optional(),
});

const ChatErrorEventPayloadSchema: z.ZodType<ChatErrorEventPayload> = z.object({
  error: z.string(),
  errorCode: z.string().optional(),
  sessionId: z.string().optional(),
});

const ChatCompleteEventPayloadSchema: z.ZodType<ChatCompleteEventPayload> = z.object({
  done: z.boolean(),
  sessionId: z.string().optional(),
});

function parseModelsResponse(payload: unknown): ModelsResponse | null {
  const parsed = ModelsResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseSessionListPayload(payload: unknown): RemoteSessionSnapshot[] {
  const parsed = SessionListResponsePayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.sessions : [];
}

function parseSessionMessagesPayload(payload: unknown): RemoteMessageSnapshot[] {
  const parsed = SessionMessagesResponsePayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.messages : [];
}

function parseChatChunkPayload(payload: unknown): ChatChunkEventPayload | null {
  const parsed = ChatChunkEventPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseChatErrorPayload(payload: unknown): ChatErrorEventPayload | null {
  const parsed = ChatErrorEventPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseChatCompletePayload(payload: unknown): ChatCompleteEventPayload | null {
  const parsed = ChatCompleteEventPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function ChatPage() {
  const {
    sessions,
    currentSessionId,
    isStreaming,
    selectedModel,
    setConnected,
    setSelectedModel,
    createSession,
    selectSession,
    syncSessionsFromServer,
    replaceSessionMessages,
    addMessage,
    updateMessage,
    appendMessageContent,
    setStreaming,
  } = useChatStore();

  const [inputValue, setInputValue] = useState('');
  const [isConnecting, setIsConnecting] = useState(true);
  const [hasSyncedSessions, setHasSyncedSessions] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingMessageIdsRef = useRef<Record<string, string | undefined>>({});
  const currentSessionIdRef = useRef<string | null>(null);
  const connectionStatusRef = useRef<ConnectionStatus>('idle');

  // Fetch available models from API
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetch('/api/models');
        if (response.ok) {
          const parsed = parseModelsResponse(await response.json());
          if (!parsed) {
            return;
          }
          const data = parsed;
          const models = data.models || [];
          const enabledModels = models.filter((m) => m.enabled);
          setAvailableModels(enabledModels);

          const enabledModelRefs = new Set(
            enabledModels.map((model) => `${model.provider}:${model.id}`)
          );
          const fallbackModel =
            (data.defaultModel && enabledModelRefs.has(data.defaultModel) && data.defaultModel) ||
            (enabledModels[0] ? `${enabledModels[0].provider}:${enabledModels[0].id}` : undefined);

          if (fallbackModel && (!selectedModel || !enabledModelRefs.has(selectedModel))) {
            setSelectedModel(fallbackModel);
          }
        }
      } catch (error) {
        console.error('Failed to fetch models:', error);
      }
    };
    
    fetchModels();
  }, []);

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  const loadSessionMessages = useCallback(
    async (sessionId: string) => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/messages`);
        if (!response.ok) {
          return;
        }

        const messages = parseSessionMessagesPayload(await response.json());
        replaceSessionMessages(sessionId, messages);
      } catch (error) {
        console.error('Failed to load session messages:', error);
      }
    },
    [replaceSessionMessages]
  );

  const syncSessions = useCallback(async () => {
    const client = getWebSocketClient();
    try {
      const response = await client.request('sessions.list');
      if (!response.ok) {
        return;
      }

      const sessionsPayload = parseSessionListPayload(response.payload);
      syncSessionsFromServer(sessionsPayload);
      const activeSessionId = useChatStore.getState().currentSessionId;
      if (activeSessionId) {
        await loadSessionMessages(activeSessionId);
      }
    } catch (error) {
      console.error('Failed to sync sessions:', error);
    } finally {
      setHasSyncedSessions(true);
    }
  }, [loadSessionMessages, syncSessionsFromServer]);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // Initialize WebSocket connection
  useEffect(() => {
    const client = getWebSocketClient();

    const unsubscribeConnection = client.onConnectionChange((status) => {
      connectionStatusRef.current = status;

      if (status === 'connected') {
        setConnected(true);
        setIsConnecting(false);
        const activeSessionId = currentSessionIdRef.current;
        if (activeSessionId) {
          void client.request('sessions.watch', { sessionId: activeSessionId }).catch(console.error);
        }
        void syncSessions();
        return;
      }

      if (status === 'connecting' || status === 'reconnecting') {
        setConnected(false);
        setIsConnecting(true);
        return;
      }

      if (status === 'disconnected' || status === 'failed') {
        setConnected(false);
        setIsConnecting(false);
        setStreaming(false);
        streamingMessageIdsRef.current = {};
      }
    });

    client.connect().catch((error) => {
      console.error('Failed to connect:', error);
      setConnected(false);
      setIsConnecting(false);
    });

    // Listen for chat events
    const unsubscribeChunk = client.onEvent('chat.chunk', (msg: WSMessage) => {
      const payload = parseChatChunkPayload(msg.payload);
      if (!payload) {
        return;
      }
      const sessionId = payload.sessionId || currentSessionIdRef.current;
      if (sessionId) {
        const streamingMessageId = streamingMessageIdsRef.current[sessionId];

        if (payload.done) {
          // Stream completed
          setStreaming(false);
          if (streamingMessageId) {
            updateMessage(sessionId, streamingMessageId, { isStreaming: false });
            delete streamingMessageIdsRef.current[sessionId];
          }
        } else if (payload.content) {
          // Append content to existing streaming message or create new one
          if (streamingMessageId) {
            appendMessageContent(sessionId, streamingMessageId, payload.content);
          } else {
            const newMessageId = Math.random().toString(36).substring(2, 15);
            streamingMessageIdsRef.current[sessionId] = newMessageId;
            addMessage(sessionId, {
              id: newMessageId,
              role: 'assistant',
              content: payload.content,
              timestamp: new Date(),
              isStreaming: true,
            });
          }
        }
      }
    });

    const unsubscribeError = client.onEvent('chat.error', (msg: WSMessage) => {
      const payload = parseChatErrorPayload(msg.payload);
      if (!payload) {
        return;
      }
      const sessionId = payload.sessionId || currentSessionIdRef.current;
      if (sessionId) {
        addMessage(sessionId, {
          id: Math.random().toString(36).substring(2, 15),
          role: 'assistant',
          content: `❌ 错误: ${payload.error}`,
          timestamp: new Date(),
        });
      }
      setStreaming(false);
      if (sessionId) {
        delete streamingMessageIdsRef.current[sessionId];
      }
    });

    const unsubscribeComplete = client.onEvent('chat.complete', (msg: WSMessage) => {
      const payload = parseChatCompletePayload(msg.payload);
      if (!payload) {
        return;
      }
      const sessionId = payload.sessionId || currentSessionIdRef.current;
      setStreaming(false);
      if (sessionId) {
        const streamingMessageId = streamingMessageIdsRef.current[sessionId];
        if (streamingMessageId) {
          updateMessage(sessionId, streamingMessageId, { isStreaming: false });
          delete streamingMessageIdsRef.current[sessionId];
        }
      }
    });

    return () => {
      unsubscribeConnection();
      unsubscribeChunk();
      unsubscribeError();
      unsubscribeComplete();
      client.disconnect();
    };
  }, [setConnected, setStreaming, syncSessions, updateMessage, addMessage, appendMessageContent]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages]);

  // Create initial session if none exists
  useEffect(() => {
    if (hasSyncedSessions && sessions.length === 0 && availableModels.length > 0 && selectedModel) {
      createSession({ modelId: selectedModel }).catch(console.error);
    }
  }, [hasSyncedSessions, sessions.length, selectedModel, availableModels.length, createSession]);

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }

    const client = getWebSocketClient();
    void loadSessionMessages(currentSessionId);
    if (connectionStatusRef.current === 'connected') {
      client.request('sessions.watch', { sessionId: currentSessionId }).catch(console.error);
    }

    return () => {
      if (connectionStatusRef.current === 'connected') {
        client.request('sessions.unwatch', {}).catch(() => {});
      }
    };
  }, [currentSessionId, loadSessionMessages]);

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || !currentSessionId || isStreaming || availableModels.length === 0) return;

    const content = inputValue.trim();
    setInputValue('');

    // Add user message
    const userMessageId = Math.random().toString(36).substring(2, 15);
    addMessage(currentSessionId, {
      id: userMessageId,
      role: 'user',
      content,
      timestamp: new Date(),
    });

    // Start streaming
    setStreaming(true);

    try {
      const client = getWebSocketClient();
      await client.request('chat.stream', {
        sessionId: currentSessionId,
        content,
        modelId: selectedModel,
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      setStreaming(false);
      addMessage(currentSessionId, {
        id: Math.random().toString(36).substring(2, 15),
        role: 'assistant',
        content: '❌ 发送消息失败，请重试',
        timestamp: new Date(),
      });
    }
  }, [inputValue, currentSessionId, isStreaming, selectedModel, availableModels.length, addMessage, setStreaming]);

  const handleNewSession = async () => {
    await createSession({ modelId: selectedModel });
  };

  return (
    <Card
      title={
        <Space>
          <span>聊天</span>
          <Select
            value={selectedModel}
            onChange={setSelectedModel}
            options={availableModels.length > 0 
              ? availableModels.map((model) => ({
                  value: `${model.provider}:${model.id}`,
                  label: model.name,
                }))
              : [{ value: '', label: '未配置模型' }]
            }
            style={{ width: 220 }}
            disabled={isStreaming || availableModels.length === 0}
          />
          {isConnecting ? (
            <Spin size="small" />
          ) : (
            <Badge status="success" text="已连接" />
          )}
        </Space>
      }
      extra={
        <Button icon={<PlusOutlined />} type="primary" onClick={handleNewSession} disabled={availableModels.length === 0}>
          新会话
        </Button>
      }
      style={{ height: 'calc(100vh - 112px)', display: 'flex', flexDirection: 'column' }}
      bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0 }}
    >
      {/* Session tabs */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', gap: 8 }}>
        {sessions.map((session) => (
          <Button
            key={session.id}
            type={session.id === currentSessionId ? 'primary' : 'default'}
            size="small"
            onClick={() => selectSession(session.id)}
          >
            {session.title}
          </Button>
        ))}
      </div>

      {/* Messages */}
      <List
        style={{ flex: 1, overflow: 'auto', padding: '16px' }}
        dataSource={currentSession?.messages || []}
        renderItem={(msg) => (
          <List.Item
            style={{
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              padding: '8px 0',
            }}
          >
            <Space align="start">
              {msg.role === 'assistant' && (
                <Avatar style={{ backgroundColor: '#0ea5e9' }} icon={<RobotOutlined />} />
              )}
              <div
                style={{
                  background: msg.role === 'user' ? '#0ea5e9' : '#f0f0f0',
                  color: msg.role === 'user' ? '#fff' : '#000',
                  padding: '12px 16px',
                  borderRadius: '12px',
                  maxWidth: '600px',
                  wordBreak: 'break-word',
                }}
              >
                {msg.role === 'assistant' || msg.role === 'system' ? (
                  <div style={{ color: '#111827' }}>
                    <MarkdownMessage content={msg.content} />
                  </div>
                ) : (
                  <Text style={{ color: 'inherit', whiteSpace: 'pre-wrap' }}>{msg.content}</Text>
                )}
                {msg.isStreaming && <Spin size="small" style={{ marginLeft: 8 }} />}
                <div style={{ fontSize: '12px', opacity: 0.6, marginTop: '4px' }}>
                  {msg.timestamp.toLocaleTimeString()}
                </div>
              </div>
              {msg.role === 'user' && (
                <Avatar style={{ backgroundColor: '#52c41a' }} icon={<UserOutlined />} />
              )}
            </Space>
          </List.Item>
        )}
      />
      <div ref={messagesEndRef} />

      {/* Input */}
      <div style={{ padding: '16px', borderTop: '1px solid #f0f0f0' }}>
        <Space.Compact style={{ width: '100%' }}>
          <TextArea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="输入消息... (Shift+Enter 换行)"
            autoSize={{ minRows: 1, maxRows: 4 }}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={isStreaming || isConnecting || availableModels.length === 0}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            loading={isStreaming}
            disabled={isConnecting || availableModels.length === 0}
          >
            发送
          </Button>
        </Space.Compact>
      </div>
    </Card>
  );
}

export default ChatPage;
