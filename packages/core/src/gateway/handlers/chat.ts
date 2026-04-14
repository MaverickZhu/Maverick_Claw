import type { GatewayRequest } from '@maverick-claw/shared';
import { createEvent } from '@maverick-claw/shared';
import type { GatewayOptions } from '../server.js';
import type { WebSocket } from '@fastify/websocket';

export async function handleChatStream(
  request: GatewayRequest,
  socket: WebSocket,
  options: GatewayOptions
): Promise<void> {
  const { sessionId, content, modelId } = request.params as {
    sessionId: string;
    content: string;
    modelId?: string;
  };

  if (!sessionId || !content) {
    socket.send(
      JSON.stringify({
        type: 'res',
        id: request.id,
        ok: false,
        error: 'Missing sessionId or content',
      })
    );
    return;
  }

  try {
    // Save user message
    await options.messageManager.createMessage({
      sessionId,
      role: 'user',
      content,
    });

    // Get conversation history
    const messages = await options.messageManager.listMessages(sessionId, { limit: 50 });
    
    // Get model manager from options
    const modelRegistry = options.modelRegistry;
    if (!modelRegistry) {
      throw new Error('Model registry not configured');
    }

    // Send acknowledgement
    socket.send(
      JSON.stringify({
        type: 'res',
        id: request.id,
        ok: true,
      })
    );

    // Parse modelId format: "provider:model" or just "provider"
    const modelRef = modelId || 'deepseek:deepseek-chat';
    const colonIndex = modelRef.indexOf(':');
    const providerId = colonIndex > 0 ? modelRef.slice(0, colonIndex) : modelRef;
    const actualModel = colonIndex > 0 ? modelRef.slice(colonIndex + 1) : modelRef;

    // Get model provider
    const provider = modelRegistry.get(providerId);
    if (!provider) {
      throw new Error(`Model provider not found: ${providerId}`);
    }

    // Stream response
    let fullContent = '';
    let assistantMessageId: string | null = null;

    const formattedMessages = messages.map((msg: { role: string; content: string }) => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    }));

    for await (const chunk of provider.chatCompletion({
      model: actualModel,
      messages: formattedMessages,
      temperature: 0.7,
      stream: true,
    })) {
      fullContent += chunk.content;

      // Send chunk to client
      const event = createEvent('chat.chunk', {
        content: chunk.content,
        done: chunk.done,
        sessionId,
      });
      socket.send(JSON.stringify(event));

      if (chunk.done) {
        // Save assistant message
        const msg = await options.messageManager.createMessage({
          sessionId,
          role: 'assistant',
          content: fullContent,
          metadata: {
            modelId: modelRef,
            providerId,
            usage: chunk.usage,
          },
        });
        assistantMessageId = msg.id;

        // Send completion event
        const completeEvent = createEvent('chat.complete', {
          messageId: assistantMessageId,
          sessionId,
          content: fullContent,
        });
        socket.send(JSON.stringify(completeEvent));
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Send error event
    const errorEvent = createEvent('chat.error', {
      error: errorMessage,
      sessionId,
    });
    socket.send(JSON.stringify(errorEvent));
  }
}
