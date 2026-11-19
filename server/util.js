export function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
export function now() { return Date.now(); }
export function json(value, fallback) { try { return JSON.parse(value || ''); } catch { return fallback; } }
export function parseJson(value, fallback) { return json(value, fallback); }
export function str(value, max = 2000) { return String(value ?? '').slice(0, max); }
export function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
export function int(value, fallback = 0) { return Math.trunc(num(value, fallback)); }

export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code || 'error'; }
}
export function badRequest(msg = 'bad_request') { return new HttpError(400, msg); }
export function unauthorized(msg = 'unauthorized') { return new HttpError(401, msg); }
export function forbidden(msg = 'forbidden') { return new HttpError(403, msg); }
export function notFound(msg = 'not_found') { return new HttpError(404, msg); }
export function conflict(msg = 'conflict') { return new HttpError(409, msg); }

export function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}
export function validatePassword(pw) {
  return typeof pw === 'string' && pw.length >= 10;
}

export function cronMatches(expr, date = new Date()) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, mon, dow] = parts;
  const values = [date.getMinutes(), date.getHours(), date.getDate(), date.getMonth() + 1, date.getDay()];
  const fields = [min, hour, dom, mon, dow];
  for (let i = 0; i < 5; i++) {
    if (!fieldMatch(fields[i], values[i])) return false;
  }
  return true;
}
function fieldMatch(field, value) {
  if (field === '*') return true;
  return field.split(',').some((part) => {
    if (part.includes('/')) {
      const [range, stepRaw] = part.split('/');
      const step = Number(stepRaw);
      if (!Number.isFinite(step) || step <= 0) return false;
      const [a, b] = range.split('-').map(Number);
      const start = Number.isFinite(a) ? a : 0;
      const end = Number.isFinite(b) ? b : 59;
      return value >= start && value <= end && (value - start) % step === 0;
    }
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      return value >= a && value <= b;
    }
    return Number(part) === value;
  });
}
