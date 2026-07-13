import { createHash, timingSafeEqual } from 'node:crypto';

const LOCAL_CLIENT_KEY = 'clipsave-client-development-only';
const ALLOWED_LANGUAGE = 'vi';
const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;

function getClientSignatureKey(): string {
  const configured = process.env.CLIENT_SIGNATURE_KEY?.trim();
  if (configured) return configured;
  if (process.env.VERCEL === '1') throw new Error('CLIENT_SIGNATURE_KEY is not configured');
  return LOCAL_CLIENT_KEY;
}

export function createExpectedClientSignature(link: string, lang: string, timestamp: string): string {
  const payload = `${lang}${timestamp}${getClientSignatureKey()}link=${link.trim()}`;
  return createHash('sha256').update(payload).digest('hex');
}

export function verifyClientSignature(
  link: string,
  lang: string | null,
  timestampValue: string | null,
  signature: string | null,
  now = Date.now(),
): boolean {
  if (lang !== ALLOWED_LANGUAGE || !timestampValue || !signature) return false;
  if (!/^\d{13}$/.test(timestampValue) || !/^[a-f0-9]{64}$/i.test(signature)) return false;

  const timestamp = Number(timestampValue);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > MAX_CLOCK_SKEW_MS) return false;

  const expected = createExpectedClientSignature(link, lang, timestampValue);
  const actualBuffer = Buffer.from(signature.toLowerCase(), 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
