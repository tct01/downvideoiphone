import assert from 'node:assert/strict';
import test from 'node:test';
import { getBlobMediaMimeType, getMediaExtension, getMediaMimeType } from '../src/lib/media-file.js';

test('uses MP4 format instead of a generic provider MIME', () => {
  const media = { kind: 'video' as const, format: 'mp4', mimeType: 'application/octet-stream' };
  assert.equal(getMediaMimeType(media, 'application/octet-stream'), 'video/mp4');
  assert.equal(getMediaExtension(media, 'video/mp4'), 'mp4');
});

test('detects an extension-less MP4 by its ftyp signature', async () => {
  const bytes = new Uint8Array(16);
  bytes.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const media = { kind: 'video' as const, format: 'unknown', mimeType: 'application/octet-stream' };

  const mimeType = await getBlobMediaMimeType(blob, media, 'application/octet-stream');
  assert.equal(mimeType, 'video/mp4');
  assert.equal(getMediaExtension(media, mimeType), 'mp4');
});

test('detects an extension-less TikTok carousel image as JPEG', async () => {
  const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])], {
    type: 'application/octet-stream',
  });
  const media = { kind: 'image' as const, format: 'jpg', mimeType: 'image/jpeg' };

  const mimeType = await getBlobMediaMimeType(blob, media, 'application/octet-stream');
  assert.equal(mimeType, 'image/jpeg');
  assert.equal(getMediaExtension(media, mimeType), 'jpg');
});
