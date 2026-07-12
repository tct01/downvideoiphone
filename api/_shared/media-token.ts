import { createHmac, timingSafeEqual } from 'node:crypto';

const LOCAL_SECRET = 'clipsave-local-development-only';

function getSecret(): string {
  const configured = process.env.MEDIA_PROXY_SECRET?.trim();
  if (configured) return configured;
  if (process.env.VERCEL === '1') throw new Error('MEDIA_PROXY_SECRET is not configured');
  return LOCAL_SECRET;
}

function digest(url: string, expires: number): string {
  return createHmac('sha256', getSecret()).update(`${expires}\n${url}`).digest('base64url');
}

export function signMediaUrl(url: string, ttlSeconds = 60 * 60): { proxyToken: string; proxyExpires: number } {
  const proxyExpires = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { proxyToken: digest(url, proxyExpires), proxyExpires };
}

export function verifyMediaToken(url: string, token: string | null, expiresValue: string | null): boolean {
  if (!token || !expiresValue) return false;
  const expires = Number(expiresValue);
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  const expected = digest(url, expires);
  const actualBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
