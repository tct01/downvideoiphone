import assert from 'node:assert/strict';
import test from 'node:test';
import { tryProviders, type Provider } from '../api/_shared/provider.js';

test('falls back immediately when a provider returns no media', async () => {
  let firstCalls = 0;
  const empty: Provider = {
    name: 'empty',
    timeoutMs: 1_000,
    async fetch() {
      firstCalls += 1;
      return { medias: [] };
    },
  };
  const fallback: Provider = {
    name: 'fallback',
    timeoutMs: 1_000,
    async fetch() {
      return { medias: [{ url: 'https://cdn.example/video.mp4', format: 'mp4' }] };
    },
  };

  await tryProviders([empty, fallback], 'https://example.com/video');
  assert.equal(firstCalls, 1);
});
