import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AdminUser } from '../models/AdminUser.js';
import { HttpError } from '../lib/http.js';

export const ADMIN_COOKIE = 'acharika_admin';
const SESSION_HOURS = 8;

export function setAdminSession(res, admin) {
  const token = jwt.sign({ sub: String(admin._id), role: admin.role }, config.jwtSecret, {
    expiresIn: `${SESSION_HOURS}h`,
  });
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProd,
    maxAge: SESSION_HOURS * 3600 * 1000,
    path: '/api',
  });
}

export function clearAdminSession(res) {
  res.clearCookie(ADMIN_COOKIE, { path: '/api' });
}

/** Requires a valid admin session. Re-reads the user so disabled accounts lose access immediately. */
export async function requireAdmin(req, _res, next) {
  try {
    const token = req.cookies?.[ADMIN_COOKIE];
    if (!token) throw new HttpError(401, 'Please log in.');
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw new HttpError(401, 'Session expired. Please log in again.');
    }
    const admin = await AdminUser.findById(payload.sub).lean();
    if (!admin || !admin.isActive) throw new HttpError(401, 'Please log in.');
    req.admin = admin;
    next();
  } catch (err) {
    next(err);
  }
}

/** Owner can do everything; other roles only what is listed. */
export const allowRoles =
  (...roles) =>
  (req, _res, next) => {
    if (req.admin.role === 'owner' || roles.includes(req.admin.role)) return next();
    next(new HttpError(403, 'You do not have permission for this action.'));
  };
