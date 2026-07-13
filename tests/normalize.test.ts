import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVideoData } from '../api/_shared/normalize.js';
import { pickBestMp4 } from '../api/_shared/pick-best.js';

test('normalizes mixed provider formats and picks the highest-quality MP4 with audio', () => {
  const medias = [
    { url: 'https://cdn.example/video-720.mp4', label: '720p', format: 'MP4', fileSize: 20_000_000 },
    { url: 'https://cdn.example/audio.mp3', label: 'Audio 320kbps', format: 'MP3', fileSize: 5_000_000 },
    { url: 'https://cdn.example/video-1080.mp4', label: '1080p', format: 'video/mp4', fileSize: 12_000_000 },
    { url: 'https://cdn.example/video-only.mp4', label: '2160p video only', format: 'mp4', fileSize: 40_000_000 },
  ];

  const normalized = normalizeVideoData({ medias });
  const best = pickBestMp4(normalized.medias);

  assert.equal(best?.label, '1080p');
  assert.equal(best?.mimeType, 'video/mp4');
  assert.equal(normalized.medias.at(-1)?.kind, 'audio');
});

test('uses safe defaults when provider omits format and MIME', () => {
  const normalized = normalizeVideoData({ medias: [{ url: 'https://api.example/download/123', label: 'HD' }] });
  assert.equal(normalized.medias[0]?.format, 'unknown');
  assert.equal(normalized.medias[0]?.mimeType, 'application/octet-stream');
  assert.equal(normalized.medias[0]?.quality, 720);
});

test('does not preserve a generic MIME when the format identifies an MP4 video', () => {
  const normalized = normalizeVideoData({ medias: [{
    url: 'https://cdn.example/download/123',
    format: 'MP4',
    mimeType: 'application/octet-stream',
  }] });
  assert.equal(normalized.medias[0]?.format, 'mp4');
  assert.equal(normalized.medias[0]?.mimeType, 'video/mp4');
});

test('deduplicates identical provider URLs', () => {
  const normalized = normalizeVideoData({ medias: [
    { url: 'https://cdn.example/video.mp4', format: 'mp4' },
    { url: 'https://cdn.example/video.mp4', format: 'MP4' },
  ] });
  assert.equal(normalized.medias.length, 1);
});

test('upgrades provider media URLs from HTTP to HTTPS', () => {
  const normalized = normalizeVideoData({ medias: [
    { url: 'http://sns-video.example/video.mp4', format: 'MP4 [3.72 MB]' },
  ] });
  assert.equal(normalized.medias[0]?.url, 'https://sns-video.example/video.mp4');
  assert.equal(normalized.medias[0]?.format, 'mp4');
});
