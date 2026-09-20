import type { NextFunction, Request, Response } from 'express';
import { userFromToken } from './db.js';
import type { PublicUser } from './types.js';

declare global {
  namespace Express { interface Request { user?: PublicUser; token?: string; } }
}

export function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7).trim();
}

export function requireAuth(req:Request,res:Response,next:NextFunction) {
  const token = bearer(req);
  const user = token ? userFromToken(token) : null;
  if (!user) return res.status(401).json({error:'unauthorized'});
  req.user = user; req.token = token!; next();
}
