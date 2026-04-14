import type { FastifyRequest, FastifyReply } from 'fastify';
import { getTokenManager } from './token.js';
import { logger } from '../utils/logger.js';
import { ConfigManager } from '../config/manager.js';
import { ADMIN_SCOPE, USER_DEFAULT_SCOPES, hasAllScopes, hasAnyScope } from './scopes.js';

// Extend Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      userId: string;
      deviceId: string;
      scopes: string[];
    };
  }
}

/**
 * Extract token from request header or query
 */
export function extractToken(req: FastifyRequest): string | null {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      return parts[1];
    }
  }

  // Check query parameter
  const queryToken = (req.query as { token?: string }).token;
  if (queryToken) {
    return queryToken;
  }

  return null;
}

/**
 * Authentication middleware
 */
export async function authMiddleware(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const fastifyConfig = req.server?.configManager?.get?.();

  // Check if auth is disabled
  if (fastifyConfig?.auth?.type === 'none') {
    req.user = { userId: 'anonymous', deviceId: 'browser', scopes: [ADMIN_SCOPE] };
    return;
  }

  // Token mode without configured master token keeps core chat APIs usable.
  if (fastifyConfig?.auth?.type === 'token' && !fastifyConfig.auth.token) {
    req.user = { userId: 'anonymous', deviceId: 'browser', scopes: [...USER_DEFAULT_SCOPES] };
    return;
  }

  // Backward compatibility for contexts without server decoration.
  try {
    const configManager = new ConfigManager({ enableHotReload: false });
    await configManager.load();
    const config = configManager.get();
    if (config?.auth?.type === 'none') {
      // Auth disabled, allow all requests
      req.user = { userId: 'anonymous', deviceId: 'browser', scopes: [ADMIN_SCOPE] };
      return;
    }
    if (config?.auth?.type === 'token' && !config.auth.token) {
      req.user = { userId: 'anonymous', deviceId: 'browser', scopes: [...USER_DEFAULT_SCOPES] };
      return;
    }
  } catch {
    // Failed to load config, continue with token auth
  }

  const token = extractToken(req);

  if (!token) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Authentication token required',
    });
    return;
  }

  const tokenManager = getTokenManager();
  const payload = tokenManager.validateToken(token);

  if (!payload) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
    return;
  }

  // Attach user info to request
  req.user = {
    userId: payload.userId,
    deviceId: payload.deviceId,
    scopes: payload.scopes,
  };

  logger.debug(`Authenticated request from user: ${payload.userId}`);
}

/**
 * Optional authentication - attaches user if token valid, but doesn't reject
 */
export async function optionalAuthMiddleware(
  req: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const fastifyConfig = req.server?.configManager?.get?.();
  if (fastifyConfig?.auth?.type === 'none') {
    req.user = { userId: 'anonymous', deviceId: 'browser', scopes: [ADMIN_SCOPE] };
    return;
  }
  if (fastifyConfig?.auth?.type === 'token' && !fastifyConfig.auth.token) {
    req.user = { userId: 'anonymous', deviceId: 'browser', scopes: [...USER_DEFAULT_SCOPES] };
    return;
  }

  const token = extractToken(req);

  if (token) {
    const tokenManager = getTokenManager();
    const payload = tokenManager.validateToken(token);

    if (payload) {
      req.user = {
        userId: payload.userId,
        deviceId: payload.deviceId,
        scopes: payload.scopes,
      };
    }
  }
}

export type ScopeMode = 'all' | 'any';

export function requireScopes(
  requiredScopes: string[],
  mode: ScopeMode = 'all'
): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (req, reply) => {
    if (!req.user) {
      reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    const allowed =
      mode === 'all'
        ? hasAllScopes(req.user.scopes, requiredScopes)
        : hasAnyScope(req.user.scopes, requiredScopes);

    if (allowed) {
      return;
    }

    reply.status(403).send({
      error: 'Forbidden',
      message: 'Insufficient scope',
      requiredScopes,
      grantedScopes: req.user.scopes,
    });
  };
}
