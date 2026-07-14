import assert from 'node:assert/strict';
import test from 'node:test';
import { tryProviders, type Provider } from '../api/_shared/provider.js';
import { gendownloadProvider } from '../api/_providers/gendownload.js';
import { snapVideoProvider } from '../api/_providers/snap-video.js';
import { tikwmProvider } from '../api/_providers/tikwm.js';

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

test('TikWM maps every TikTok carousel image and keeps the soundtrack', async (t) => {
  let requestBody = '';
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    requestBody = String(init?.body ?? '');
    return Response.json({
      code: 0,
      msg: 'success',
      data: {
        title: 'TikTok photo post',
        images: [
          'https://p16-sign.tiktokcdn.com/photo-one',
          { url: 'https://p16-sign.tiktokcdn.com/photo-two' },
        ],
        music: 'https://sf16.tiktokcdn.com/music.mp3',
      },
    });
  });

  const result = await tikwmProvider.fetch('https://www.tiktok.com/@user/photo/123');

  assert.match(requestBody, /(?:^|&)hd=1(?:&|$)/);
  assert.match(requestBody, /(?:^|&)url=https%3A%2F%2Fwww\.tiktok\.com/);
  assert.equal(result.imageUrl, 'https://p16-sign.tiktokcdn.com/photo-one');
  assert.deepEqual(result.medias.map((media) => media.kind), ['image', 'image', 'audio']);
  assert.deepEqual(result.medias.slice(0, 2).map((media) => media.label), ['Ảnh 1', 'Ảnh 2']);
  assert.equal(result.medias[0]?.mimeType, 'image/jpeg');
});

test('TikWM prioritizes HD, no-watermark and watermark TikTok video variants', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    code: 0,
    data: {
      title: 'TikTok video',
      cover: 'https://p16.tiktokcdn.com/cover.jpg',
      hdplay: 'https://v16.tiktokcdn.com/hd.mp4',
      play: 'https://v16.tiktokcdn.com/regular.mp4',
      wmplay: 'https://v16.tiktokcdn.com/watermark.mp4',
      hdsize: 12_000_000,
      size: 8_000_000,
      wmsize: 9_000_000,
    },
  }));

  const result = await tikwmProvider.fetch('https://vm.tiktok.com/example');

  assert.deepEqual(result.medias.map((media) => media.label), [
    'HD · Không watermark',
    'Không watermark',
    'Có watermark',
  ]);
  assert.equal(result.medias[0]?.fileSize, 12_000_000);
  assert.equal(result.medias[0]?.kind, 'video');
  assert.equal(result.medias[0]?.mimeType, 'video/mp4');
});
