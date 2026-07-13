import assert from 'node:assert/strict';
import test from 'node:test';
import { tryProviders, type Provider } from '../api/_shared/provider.js';
import { gendownloadProvider } from '../api/_providers/gendownload.js';
import { snapVideoProvider } from '../api/_providers/snap-video.js';

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

test('GenDownload preserves Google Video URLs and supplies media metadata', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    title: 'Video',
    formats: [{
      label: '1080p',
      type: 'video',
      ext: 'mp4',
      url: 'https://redirector.googlevideo.com/videoplayback?id=example',
    }],
  }));

  const result = await gendownloadProvider.fetch('https://youtube.com/watch?v=example');
  assert.equal(result.medias.length, 1);
  assert.equal(result.medias[0]?.kind, 'video');
  assert.equal(result.medias[0]?.format, 'mp4');
  assert.equal(result.medias[0]?.mimeType, 'video/mp4');
});

test('Snap Video marks extension-less render output as MP4', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    title: 'Douyin video',
    videos: [{ format_id: 'best', label: 'HD', direct_link: 'https://cdn.example/download/123' }],
  }));

  const result = await snapVideoProvider.fetch('https://v.douyin.com/example');
  assert.equal(result.medias[0]?.kind, 'video');
  assert.equal(result.medias[0]?.format, 'mp4');
  assert.equal(result.medias[0]?.mimeType, 'video/mp4');
});
