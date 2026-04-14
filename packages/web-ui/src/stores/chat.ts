import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface RemoteMessageSnapshot {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: string | Date;
}

export interface Session {
  id: string;
  title: string;
  messages: Message[];
  modelId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RemoteSessionSnapshot {
  id: string;
  title: string;
  modelId?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface ChatState {
  sessions: Session[];
  currentSessionId: string | null;
  isConnected: boolean;
  isStreaming: boolean;
  selectedModel: string;
  
  // Actions
  setConnected: (connected: boolean) => void;
  setSelectedModel: (model: string) => void;
  createSession: (options?: { title?: string; modelId?: string }) => Promise<string>;
  selectSession: (id: string) => void;
  syncSessionsFromServer: (sessions: RemoteSessionSnapshot[]) => void;
  replaceSessionMessages: (sessionId: string, messages: RemoteMessageSnapshot[]) => void;
  addMessage: (sessionId: string, message: Message) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void;
  appendMessageContent: (sessionId: string, messageId: string, content: string) => void;
  setStreaming: (streaming: boolean) => void;
  clearSession: (sessionId: string) => void;
}

const toDate = (value: string | Date | undefined): Date => {
  if (value instanceof Date) {
    return value;
  }
  if (!value) {
    return new Date();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const toMessageRole = (role: RemoteMessageSnapshot['role']): Message['role'] => {
  return role === 'tool' ? 'system' : role;
};

export const useChatStore = create<ChatState>()(
  devtools(
    persist((set, get) => ({
      sessions: [],
      currentSessionId: null,
      isConnected: false,
      isStreaming: false,
      selectedModel: 'deepseek:deepseek-chat',

      setConnected: (connected) => set({ isConnected: connected }),

      setSelectedModel: (model) => set({ selectedModel: model }),

      createSession: async (options) => {
        const modelId = options?.modelId ?? get().selectedModel;
        const title = options?.title ?? '新会话';
        // Create session via API
        try {
          const response = await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, modelId }),
          });
          
          if (!response.ok) {
            throw new Error('Failed to create session');
          }
          
          const session = await response.json();
          
          const newSession: Session = {
            id: session.id,
            title: session.title,
            messages: [],
            modelId: session.modelId || modelId,
            createdAt: new Date(session.createdAt),
            updatedAt: new Date(session.updatedAt),
          };
          
          set((state) => ({
            sessions: [newSession, ...state.sessions],
            currentSessionId: session.id,
          }));
          
          return session.id;
        } catch (error) {
          console.error('Failed to create session:', error);
          // Fallback: create local session only
          const id = Math.random().toString(36).substring(2, 15);
          const newSession: Session = {
            id,
            title,
            messages: [],
            modelId,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          
          set((state) => ({
            sessions: [newSession, ...state.sessions],
            currentSessionId: id,
          }));
          
          return id;
        }
      },

      selectSession: (id) => set({ currentSessionId: id }),

      syncSessionsFromServer: (remoteSessions) => {
        set((state) => {
          const existingById = new Map(state.sessions.map((session) => [session.id, session]));
          const normalizedRemoteSessions: Session[] = remoteSessions.map((remote) => {
            const existing = existingById.get(remote.id);
            return {
              id: remote.id,
              title: remote.title || existing?.title || '新会话',
              messages: existing?.messages || [],
              modelId: remote.modelId || existing?.modelId,
              createdAt: toDate(remote.createdAt),
              updatedAt: toDate(remote.updatedAt),
            };
          });

          const remoteIds = new Set(normalizedRemoteSessions.map((session) => session.id));
          const localOnlySessions = state.sessions.filter((session) => !remoteIds.has(session.id));
          const mergedSessions = [...normalizedRemoteSessions, ...localOnlySessions].sort(
            (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
          );
          const currentSessionId =
            state.currentSessionId && mergedSessions.some((session) => session.id === state.currentSessionId)
              ? state.currentSessionId
              : mergedSessions[0]?.id || null;

          return {
            sessions: mergedSessions,
            currentSessionId,
          };
        });
      },

      replaceSessionMessages: (sessionId, remoteMessages) => {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  messages: remoteMessages.map((message) => ({
                    id: message.id,
                    role: toMessageRole(message.role),
                    content: message.content,
                    timestamp: toDate(message.createdAt),
                  })),
                  updatedAt: new Date(),
                }
              : session
          ),
        }));
      },

      addMessage: (sessionId, message) => {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? { ...session, messages: [...session.messages, message], updatedAt: new Date() }
              : session
          ),
        }));
      },

      updateMessage: (sessionId, messageId, updates) => {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  messages: session.messages.map((msg) =>
                    msg.id === messageId ? { ...msg, ...updates } : msg
                  ),
                  updatedAt: new Date(),
                }
              : session
          ),
        }));
      },

      appendMessageContent: (sessionId, messageId, content) => {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  messages: session.messages.map((msg) =>
                    msg.id === messageId
                      ? { ...msg, content: msg.content + content }
                      : msg
                  ),
                  updatedAt: new Date(),
                }
              : session
          ),
        }));
      },

      setStreaming: (streaming) => set({ isStreaming: streaming }),

      clearSession: (sessionId) => {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? { ...session, messages: [], updatedAt: new Date() }
              : session
          ),
        }));
      },
    }), {
      name: 'chat-store',
      partialize: (state) => ({
        selectedModel: state.selectedModel,
      }),
    }),
    { name: 'chat-store-devtools' }
  )
);
