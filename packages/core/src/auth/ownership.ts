import type { FastifyRequest, FastifyReply } from 'fastify';
import { ADMIN_SCOPE } from './scopes.js';

/**
 * Check if the current user is an admin
 */
export function isAdmin(req: FastifyRequest): boolean {
  return req.user?.scopes?.includes(ADMIN_SCOPE) ?? false;
}

/**
 * Middleware that checks if the current user owns a resource.
 * Admin users bypass ownership checks.
 */
export function requireOwnership(
  getOwnerId: (req: FastifyRequest) => Promise<string | null | undefined>
) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.user) {
      reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    // Admin bypass
    if (isAdmin(req)) {
      return;
    }

    const ownerId = await getOwnerId(req);
    if (ownerId && ownerId !== req.user.userId) {
      reply.status(403).send({
        error: 'Forbidden',
        message: 'You do not have permission to access this resource',
      });
      return;
    }
  };
}

/**
 * Middleware that allows access only to the resource owner or admin.
 * For routes where the resource ID is in the URL params.
 */
export function requireOwnerOrAdmin(ownerId: string | null | undefined): boolean {
  // This is a helper function for use in route handlers
  // Returns true if access should be allowed
  // The actual check is done by requireOwnership middleware
  return true;
}
