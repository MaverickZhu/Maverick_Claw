import {
  Card,
  Input,
  Button,
  List,
  Avatar,
  Space,
  Select,
  Typography,
  Spin,
  Badge,
  Upload,
  Tag,
  Tooltip,
  Empty,
  Popconfirm,
} from 'antd';
import {
  SendOutlined,
  PlusOutlined,
  RobotOutlined,
  UserOutlined,
  PaperClipOutlined,
  CloseOutlined,
  FileOutlined,
  PictureOutlined,
  SunOutlined,
  MoonOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useChatStore, type RemoteMessageSnapshot, type RemoteSessionSnapshot } from '../stores/chat';
import { useThemeStore } from '../stores/theme';
import { getWebSocketClient, type ConnectionStatus, type WSMessage } from '../api/websocket';
import { apiGet, apiDelete, apiUpload } from '../api/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { z } from 'zod';
import type {
  ChatChunkEventPayload,
  ChatCompleteEventPayload,
  ChatErrorEventPayload,
  FileAttachment,
} from '@maverick-claw/shared';

const { TextArea } = Input;
const { Text } = Typography;

/* ------------------------------------------------------------------ */
/*  Markdown 渲染                                                      */
/* ------------------------------------------------------------------ */

function MarkdownMessage({ content, isDark }: { content: string; isDark: boolean }) {
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
                background: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
                color: 'inherit',
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

/* ------------------------------------------------------------------ */
/*  附件预览                                                            */
/* ------------------------------------------------------------------ */

function AttachmentPreview({ attachment }: { attachment: FileAttachment }) {
  const isImage = attachment.mimeType.startsWith('image/');

  if (isImage) {
    return (
      <a href={attachment.url} target="_blank" rel="noreferrer">
        <img
          src={attachment.url}
          alt={attachment.name}
          style={{
            maxWidth: 200,
            maxHeight: 150,
            borderRadius: 8,
            objectFit: 'cover',
            border: '1px solid rgba(0,0,0,0.1)',
          }}
        />
      </a>
    );
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        background: 'rgba(0,0,0,0.05)',
        borderRadius: 6,
        color: '#1677ff',
        fontSize: 12,
        textDecoration: 'none',
      }}
    >
      <FileOutlined />
      <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {attachment.name}
      </span>
    </a>
  );
}

/* ------------------------------------------------------------------ */
/*  时间格式化                                                          */
/* ------------------------------------------------------------------ */

function formatMessageTime(timestamp: Date): string {
  const now = new Date();
  const date = new Date(timestamp);
  const isToday = date.toDateString() === now.toDateString();
  const isYesterday = new Date(now.getTime() - 86400000).toDateString() === date.toDateString();

  const timeStr = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  if (isToday) return timeStr;
  if (isYesterday) return `昨天 ${timeStr}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${timeStr}`;
}

/* ------------------------------------------------------------------ */
/*  类型 / Schema                                                      */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  单条消息组件                                                        */
/* ------------------------------------------------------------------ */

interface MessageItemProps {
  msg: ReturnType<typeof useChatStore.getState>['sessions'][number]['messages'][number];
  isDark: boolean;
}

function MessageItem({ msg, isDark }: MessageItemProps) {
  const isUser = msg.role === 'user';
  const isError = msg.content.startsWith('❌');

  const bubbleBg = isError
    ? isDark
      ? '#4a1c1c'
      : '#fff2f0'
    : isUser
      ? '#0ea5e9'
      : isDark
        ? '#262626'
        : '#f0f0f0';

  const bubbleColor = isError
    ? isDark
      ? '#ffccc7'
      : '#cf1322'
    : isUser
      ? '#fff'
      : isDark
        ? '#e5e5e5'
        : '#000';

  const avatarBg = isUser ? '#52c41a' : '#0ea5e9';
  const avatarIcon = isUser ? <UserOutlined /> : <RobotOutlined />;

  return (
    <List.Item
      style={{
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        padding: '6px 0',
        borderBottom: 'none',
      }}
    >
      <Space align="start" size={10}>
        {!isUser && (
          <Avatar
            style={{
              backgroundColor: avatarBg,
              flexShrink: 0,
              marginTop: 4,
            }}
            icon={avatarIcon}
            size="small"
          />
        )}

        <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
          <div
            style={{
              background: bubbleBg,
              color: bubbleColor,
              padding: '10px 14px',
              borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              wordBreak: 'break-word',
              lineHeight: 1.6,
              boxShadow: isDark
                ? '0 1px 2px rgba(0,0,0,0.3)'
                : '0 1px 2px rgba(0,0,0,0.06)',
            }}
          >
            {msg.role === 'assistant' || msg.role === 'system' ? (
              <div style={{ color: isError ? 'inherit' : isDark ? '#e5e5e5' : '#111827' }}>
                <MarkdownMessage content={msg.content} isDark={isDark} />
              </div>
            ) : (
              <Text style={{ color: 'inherit', whiteSpace: 'pre-wrap' }}>{msg.content}</Text>
            )}

            {/* Attachments */}
            {msg.attachments && msg.attachments.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {msg.attachments.map((att) => (
                  <AttachmentPreview key={att.fileId} attachment={att} />
                ))}
              </div>
            )}

            {/* Streaming cursor */}
            {msg.isStreaming && (
              <span
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 16,
                  background: isDark ? '#0ea5e9' : '#0ea5e9',
                  marginLeft: 4,
                  borderRadius: 1,
                  animation: 'chat-cursor-blink 1s step-end infinite',
                  verticalAlign: 'middle',
                }}
              />
            )}
          </div>

          <Tooltip title={msg.timestamp.toLocaleString('zh-CN')}>
            <span
              style={{
                fontSize: 11,
                color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)',
                marginTop: 4,
                padding: '0 4px',
              }}
            >
              {formatMessageTime(msg.timestamp)}
            </span>
          </Tooltip>
        </div>

        {isUser && (
          <Avatar
            style={{
              backgroundColor: avatarBg,
              flexShrink: 0,
              marginTop: 4,
            }}
            icon={avatarIcon}
            size="small"
          />
        )}
      </Space>
    </List.Item>
  );
}

/* ------------------------------------------------------------------ */
/*  空状态                                                              */
/* ------------------------------------------------------------------ */

function ChatEmptyState({ isDark }: { isDark: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
      }}
    >
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <span style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' }}>
            开始新对话，或输入消息与 AI 交流
          </span>
        }
      />
      <div
        style={{
          marginTop: 16,
          padding: '12px 20px',
          borderRadius: 12,
          background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
          border: `1px dashed ${isDark ? 'rgba(255,255,255,0.1)' : '#d9d9d9'}`,
          color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)',
          fontSize: 13,
          textAlign: 'center',
          lineHeight: 1.6,
        }}
      >
        💡 提示：支持 Markdown 格式、代码高亮、文件上传
        <br />
        Shift + Enter 换行，Enter 直接发送
      </div>
    </div>
  );
}

/* ================================================================== */
/*  主页面                                                              */
/* ================================================================== */

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
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const { theme, toggleTheme } = useThemeStore();
  const isDark = theme === 'dark';
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingMessageIdsRef = useRef<Record<string, string | undefined>>({});
  const currentSessionIdRef = useRef<string | null>(null);
  const connectionStatusRef = useRef<ConnectionStatus>('idle');

  // Fetch available models from API
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await apiGet('/api/models');
        const parsed = parseModelsResponse(response);
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
        const data = await apiGet(`/api/sessions/${sessionId}/messages`);
        const messages = parseSessionMessagesPayload(data);
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

  const handleUpload = async (file: File): Promise<FileAttachment | null> => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const result = await apiUpload<FileAttachment>('/api/upload', formData);
      return result;
    } catch (error) {
      console.error('Failed to upload file:', error);
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const result = await handleUpload(file);
      if (result) {
        setAttachments((prev) => [...prev, result]);
      }
    }
    e.target.value = '';
  };

  const handleRemoveAttachment = (fileId: string) => {
    setAttachments((prev) => prev.filter((a) => a.fileId !== fileId));
  };

  const handleSend = useCallback(async () => {
    if ((!inputValue.trim() && attachments.length === 0) || !currentSessionId || isStreaming || availableModels.length === 0) return;

    const content = inputValue.trim() || '[文件消息]';
    setInputValue('');
    const currentAttachments = attachments;
    setAttachments([]);

    // Add user message
    const userMessageId = Math.random().toString(36).substring(2, 15);
    addMessage(currentSessionId, {
      id: userMessageId,
      role: 'user',
      content,
      timestamp: new Date(),
      attachments: currentAttachments,
    });

    // Start streaming
    setStreaming(true);

    try {
      const client = getWebSocketClient();
      await client.request('chat.stream', {
        sessionId: currentSessionId,
        content,
        modelId: selectedModel,
        attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
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
  }, [inputValue, currentSessionId, isStreaming, selectedModel, availableModels.length, addMessage, setStreaming, attachments]);

  const handleNewSession = async () => {
    await createSession({ modelId: selectedModel });
  };

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiDelete(`/api/sessions/${sessionId}`);
      // Refresh session list
      void syncSessions();
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const messages = currentSession?.messages || [];
  const hasMessages = messages.length > 0;

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
          <Button
            type="text"
            icon={isDark ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggleTheme}
            title={isDark ? '切换浅色模式' : '切换深色模式'}
          />
        </Space>
      }
      extra={
        <Button icon={<PlusOutlined />} type="primary" onClick={handleNewSession} disabled={availableModels.length === 0}>
          新会话
        </Button>
      }
      style={{ height: 'calc(100vh - 112px)', display: 'flex', flexDirection: 'column' }}
      bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
    >
      {/* Session tabs */}
      <div
        style={{
          padding: '8px 16px',
          borderBottom: `1px solid ${isDark ? '#303030' : '#f0f0f0'}`,
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          flexWrap: 'nowrap',
          scrollbarWidth: 'thin',
        }}
      >
        {sessions.map((session) => (
          <Button
            key={session.id}
            type={session.id === currentSessionId ? 'primary' : 'default'}
            size="small"
            onClick={() => selectSession(session.id)}
            style={{
              flexShrink: 0,
              maxWidth: 160,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.title}</span>
            <CloseOutlined
              onClick={(e) => handleDeleteSession(session.id, e)}
              style={{
                fontSize: 10,
                opacity: 0.6,
                cursor: 'pointer',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0.6'; }}
            />
          </Button>
        ))}
      </div>

      {/* Messages */}
      {hasMessages ? (
        <List
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '12px 16px',
          }}
          dataSource={messages}
          renderItem={(msg) => <MessageItem msg={msg} isDark={isDark} />}
        />
      ) : (
        <ChatEmptyState isDark={isDark} />
      )}
      <div ref={messagesEndRef} />

      {/* Input */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: `1px solid ${isDark ? '#303030' : '#f0f0f0'}`,
          background: isDark ? '#141414' : '#fff',
        }}
      >
        {/* Selected attachments */}
        {attachments.length > 0 && (
          <div style={{ marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {attachments.map((att) => (
              <Tag
                key={att.fileId}
                closable
                onClose={() => handleRemoveAttachment(att.fileId)}
                icon={att.mimeType.startsWith('image/') ? <PictureOutlined /> : <FileOutlined />}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '4px 10px',
                  borderRadius: 8,
                }}
              >
                <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {att.name}
                </span>
              </Tag>
            ))}
          </div>
        )}
        <Space.Compact style={{ width: '100%' }}>
          <input
            type="file"
            id="file-upload"
            style={{ display: 'none' }}
            multiple
            onChange={handleFileSelect}
            disabled={isStreaming || isConnecting || availableModels.length === 0 || uploading}
          />
          <Tooltip title="上传文件">
            <Button
              icon={<PaperClipOutlined />}
              onClick={() => document.getElementById('file-upload')?.click()}
              loading={uploading}
              disabled={isStreaming || isConnecting || availableModels.length === 0}
            />
          </Tooltip>
          <TextArea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={attachments.length > 0 ? '输入消息（可选）…' : '输入消息… (Shift+Enter 换行)'}
            autoSize={{ minRows: 1, maxRows: 6 }}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={isStreaming || isConnecting || availableModels.length === 0}
            style={{ borderRadius: 0 }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            loading={isStreaming}
            disabled={isConnecting || availableModels.length === 0}
          >
            {isStreaming ? '生成中' : '发送'}
          </Button>
        </Space.Compact>
      </div>
    </Card>
  );
}

export default ChatPage;
