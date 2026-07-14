import assert from 'node:assert/strict';
import test from 'node:test';
import { GET, providersForLink } from '../api/video.js';
import {
  createExpectedClientSignature,
  verifyClientSignature,
} from '../api/_shared/client-signature.js';

test('accepts a fresh client signature and rejects tampering or stale requests', async () => {
  const previousKey = process.env.CLIENT_SIGNATURE_KEY;
  process.env.CLIENT_SIGNATURE_KEY = 'test-client-signature-key';

  try {
    const link = 'https://www.youtube.com/shorts/example';
    const now = Date.now();
    const timestamp = String(now);
    const signature = createExpectedClientSignature(link, 'vi', timestamp);

    assert.equal(verifyClientSignature(link, 'vi', timestamp, signature, now), true);
    assert.equal(verifyClientSignature(`${link}?changed=1`, 'vi', timestamp, signature, now), false);
    assert.equal(verifyClientSignature(link, 'vi', String(now - 120_001), signature, now), false);

    const unsignedResponse = await GET(new Request(
      `https://www.clipsave.top/api/video?link=${encodeURIComponent(link)}`,
    ));
    assert.equal(unsignedResponse.status, 403);
    assert.equal(unsignedResponse.headers.get('cache-control'), 'private, no-store');
  } finally {
    if (previousKey === undefined) delete process.env.CLIENT_SIGNATURE_KEY;
    else process.env.CLIENT_SIGNATURE_KEY = previousKey;
  }
});

test('uses platform-specific provider priorities for TikTok and YouTube', () => {
  assert.deepEqual(
    providersForLink('https://www.tiktok.com/@user/photo/123').map((provider) => provider.name),
    ['seekin', 'tikwm', 'snap-video', 'gendownload'],
  );
  assert.deepEqual(
    providersForLink('https://www.youtube.com/watch?v=example').map((provider) => provider.name),
    ['gendownload', 'seekin', 'snap-video', 'tikwm'],
  );
  assert.deepEqual(
    providersForLink('https://youtu.be/example').map((provider) => provider.name),
    ['gendownload', 'seekin', 'snap-video', 'tikwm'],
  );
});
