import assert from 'node:assert/strict';
import test from 'node:test';
import { collectProviders, tryProviders, type Provider } from '../api/_shared/provider.js';

test('retries a transient provider failure twice before succeeding', async () => {
  let calls = 0;
  const provider: Provider = {
    name: 'transient',
    timeoutMs: 1_000,
    retries: 2,
    async fetch() {
      calls += 1;
      if (calls < 3) throw new Error('provider:503');
      return { medias: [{ url: 'https://cdn.example/video.mp4', format: 'mp4' }] };
    },
  };

  const result = await tryProviders([provider], 'https://example.com/video');
  assert.equal(calls, 3);
  assert.equal(result.medias.length, 1);
});

test('does not retry a definitive no-media response and falls back immediately', async () => {
  let firstCalls = 0;
  const empty: Provider = {
    name: 'empty',
    timeoutMs: 1_000,
    retries: 2,
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

test('merges media from all successful providers in priority order', async () => {
  const providers: Provider[] = [
    { name: 'primary', timeoutMs: 1_000, async fetch() { return { title: 'Primary title', medias: [{ url: 'https://cdn.example/video.mp4', format: 'mp4' }] }; } },
    { name: 'audio', timeoutMs: 1_000, async fetch() { return { title: 'Secondary title', medias: [{ url: 'https://cdn.example/audio.mp3', format: 'mp3' }] }; } },
  ];
  const result = await collectProviders(providers, 'https://example.com/video');
  assert.equal(result.title, 'Primary title');
  assert.equal(result.medias.length, 2);
});

test('calls later providers when the first batch has fewer than two media', async () => {
  let fallbackCalls = 0;
  const providers: Provider[] = [
    { name: 'primary', timeoutMs: 1_000, async fetch() { return { medias: [{ url: 'https://cdn.example/video.mp4' }] }; } },
    { name: 'empty', timeoutMs: 1_000, async fetch() { throw new Error('no_media'); } },
    { name: 'fallback', timeoutMs: 1_000, async fetch() { fallbackCalls += 1; return { medias: [{ url: 'https://cdn.example/audio.mp3' }] }; } },
  ];
  const result = await collectProviders(providers, 'https://example.com/video');
  assert.equal(fallbackCalls, 1);
  assert.equal(result.medias.length, 2);
});
