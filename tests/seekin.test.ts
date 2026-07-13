import assert from 'node:assert/strict';
import test from 'node:test';
import { seekinProvider } from '../api/_providers/seekin.js';

test('keeps googlevideo media returned by Seekin', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    code: '0000',
    data: {
      title: 'YouTube video',
      medias: [
        {
          url: 'https://redirector.googlevideo.com/videoplayback?id=example',
          format: '1080p (9.63 MB) [.mp4]',
        },
        {
          url: 'https://redirector.googlevideo.com/videoplayback?id=audio',
          format: '1080p (525.64 KB) [.m4a]',
        },
      ],
    },
  }));

  const result = await seekinProvider.fetch('https://www.youtube.com/shorts/example');

  assert.equal(result.medias.length, 2);
  assert.equal(new URL(result.medias[0].url).hostname, 'redirector.googlevideo.com');
  assert.deepEqual(result.medias[0], {
    url: 'https://redirector.googlevideo.com/videoplayback?id=example',
    label: '1080p · MP4',
    format: 'mp4',
    fileSize: 10_097_787,
    sizeStr: '9.63 MB',
    kind: 'video',
    mimeType: 'video/mp4',
  });
  assert.equal(result.medias[1].label, 'Audio · M4A');
  assert.equal(result.medias[1].format, 'm4a');
  assert.equal(result.medias[1].kind, 'audio');
  assert.equal(result.medias[1].sizeStr, '525.64 KB');
});

test('defaults a Douyin video without an extension to MP4', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    code: '0000',
    data: {
      title: 'Douyin video',
      medias: [{ url: 'https://v3-dy.example.com/video/tos/cn/tos-cn-ve-15/oABC', label: 'HD' }],
    },
  }));

  const result = await seekinProvider.fetch('https://v.douyin.com/example');
  assert.equal(result.medias[0]?.kind, 'video');
  assert.equal(result.medias[0]?.format, 'mp4');
  assert.equal(result.medias[0]?.mimeType, 'video/mp4');
});
