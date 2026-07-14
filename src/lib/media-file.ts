export type MediaFileDescriptor = {
  format?: string | null;
  kind?: 'video' | 'audio' | 'image';
  mimeType?: string | null;
};

const GENERIC_MIME_TYPES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
  'application/binary',
  'application/download',
]);

function cleanMimeType(value?: string | null): string {
  return (value ?? '').split(';', 1)[0].trim().toLowerCase();
}

function isMediaMimeType(value: string): boolean {
  return !GENERIC_MIME_TYPES.has(value) && (value.startsWith('video/') || value.startsWith('audio/') || value.startsWith('image/'));
}

export function getMediaMimeType(media: MediaFileDescriptor, responseType = ''): string {
  const responseMime = cleanMimeType(responseType);
  if (isMediaMimeType(responseMime)) return responseMime;

  const declaredMime = cleanMimeType(media.mimeType);
  if (isMediaMimeType(declaredMime)) return declaredMime;

  const format = (media.format ?? '').trim().toLowerCase().replace(/^\./, '');
  if (media.kind === 'image' || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'avif'].includes(format)) {
    if (format === 'jpg' || format === 'jpeg') return 'image/jpeg';
    if (format === 'heic' || format === 'heif') return 'image/heic';
    return format ? `image/${format}` : 'image/jpeg';
  }
  if (media.kind === 'audio' || ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'weba'].includes(format)) {
    if (format === 'm4a' || format === 'aac') return 'audio/mp4';
    if (format === 'ogg' || format === 'opus') return 'audio/ogg';
    if (format === 'weba' || format === 'webm') return 'audio/webm';
    return 'audio/mpeg';
  }
  if (format === 'mp4' || format === 'm4v') return 'video/mp4';
  if (format === 'webm') return 'video/webm';
  if (format === 'mov') return 'video/quicktime';
  return 'application/octet-stream';
}

function bytesEqual(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

/** Detect the real container when providers and CDNs only return octet-stream. */
export async function getBlobMediaMimeType(
  blob: Blob,
  media: MediaFileDescriptor,
  responseType = '',
): Promise<string> {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());

  if (bytes.length >= 3 && bytesEqual(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (bytes.length >= 8 && bytesEqual(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)).startsWith('GIF8')) return 'image/gif';
  if (bytes.length >= 12 && bytesEqual(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && bytesEqual(bytes, 8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';

  // ISO Base Media File Format: MP4, M4A and QuickTime all contain `ftyp` at byte 4.
  if (bytes.length >= 12 && bytesEqual(bytes, 4, [0x66, 0x74, 0x79, 0x70])) {
    const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
    if (['avif', 'avis'].includes(brand)) return 'image/avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
    if (media.kind === 'audio' || brand === 'm4a ' || brand === 'm4b ') return 'audio/mp4';
    if (brand === 'qt  ') return 'video/quicktime';
    return 'video/mp4';
  }
  if (bytes.length >= 4 && bytesEqual(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) {
    return media.kind === 'audio' ? 'audio/webm' : 'video/webm';
  }
  if (
    (bytes.length >= 3 && bytesEqual(bytes, 0, [0x49, 0x44, 0x33]))
    || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  ) {
    return 'audio/mpeg';
  }
  if (bytes.length >= 4 && bytesEqual(bytes, 0, [0x4f, 0x67, 0x67, 0x53])) return 'audio/ogg';

  return getMediaMimeType(media, responseType);
}

export function getMediaExtension(media: MediaFileDescriptor, mimeType = ''): string {
  const mime = cleanMimeType(mimeType);
  if (mime === 'video/mp4') return 'mp4';
  if (mime === 'video/webm' || mime === 'audio/webm') return 'webm';
  if (mime === 'video/quicktime') return 'mov';
  if (mime === 'audio/mpeg') return 'mp3';
  if (mime === 'audio/mp4') return 'm4a';
  if (mime === 'audio/ogg') return 'ogg';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/heic' || mime === 'image/heif') return 'heic';
  if (mime === 'image/avif') return 'avif';

  const format = (media.format ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['mp4', 'webm', 'mov', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'avif'].includes(format)) return format === 'jpeg' ? 'jpg' : format;
  return media.kind === 'audio' ? 'audio' : media.kind === 'image' ? 'jpg' : 'video';
}
