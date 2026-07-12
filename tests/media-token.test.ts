import assert from 'node:assert/strict';
import test from 'node:test';
import { signMediaUrl, verifyMediaToken } from '../api/_shared/media-token.js';

test('accepts a valid signed media URL and rejects tampering', () => {
  const url = 'https://cdn.example/video.mp4';
  const signed = signMediaUrl(url, 60);
  assert.equal(verifyMediaToken(url, signed.proxyToken, String(signed.proxyExpires)), true);
  assert.equal(verifyMediaToken(`${url}?changed=1`, signed.proxyToken, String(signed.proxyExpires)), false);
});

test('rejects an expired media URL signature', () => {
  const url = 'https://cdn.example/video.mp4';
  const signed = signMediaUrl(url, -1);
  assert.equal(verifyMediaToken(url, signed.proxyToken, String(signed.proxyExpires)), false);
});
