// .light — permission catalogue and role-based access control helpers.
// The built-in 'admin' role is implicit and always has every permission;
// all other roles are looked up in the `roles` table by their id.
import { getDb } from './db.js';
import { json, unauthorized, forbidden } from './util.js';

export const PERMISSIONS = Object.freeze([
  'admin.access',
  'customers.read', 'customers.write',
  'services.read', 'services.write',
  'products.read', 'products.write',
  'plans.read', 'plans.write',
  'environments.read', 'environments.write',
  'nodes.read', 'nodes.write',
  'billing.read', 'billing.write',
  'domains.read', 'domains.write',
  'backups.read', 'schedules.read',
  'audit.read',
  'tickets.read', 'tickets.write',
  'notifications.read', 'notifications.write',
  'analytics.read',
  'roles.read', 'roles.write',
  'settings.read', 'settings.write',
]);

export function isValidPermission(p) { return PERMISSIONS.includes(p) || p === '*'; }

/** Effective permissions for a user (admin => all). */
export function permissionsFor(user) {
  if (!user) return [];
  if (user.role === 'admin') return ['*', ...PERMISSIONS];
  const db = getDb();
  if (!db) return [];
  const role = db.prepare('SELECT permissions FROM roles WHERE id = ?').get(user.role);
  return role ? json(role.permissions, []) : [];
}

/** Does this user hold a permission? */
export function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!permission) return true; // authenticated is enough
  const perms = permissionsFor(user);
  return perms.includes('*') || perms.includes(permission);
}

/** Express middleware for a single required permission. */
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!hasPermission(req.user, permission)) return next(forbidden('permission_required'));
    next();
  };
}

/** Only a real (non-impersonating) administrator may use privileged actions. */
export function requireRealAdmin(req, res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin' || req.impersonatedBy) return next(forbidden('admin_required'));
  next();
}
