import type { Media, NormalizedMedia, NormalizedVideoData, VideoData } from './types.js';

const AUDIO_FORMATS = ['mp3', 'aac', 'm4a', 'opus', 'ogg', 'wav', 'flac'];
const VIDEO_FORMATS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'ts'];
const KNOWN_FORMATS = [...VIDEO_FORMATS, ...AUDIO_FORMATS];

function extensionFromUrl(value: string): string {
  try {
    const match = new URL(value).pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
    return match?.[1] ?? '';
  } catch {
    return '';
  }
}

function qualityFromText(value: string): number {
  const text = value.toLowerCase();
  if (/\b(4k|uhd)\b/.test(text)) return 2160;
  if (/\b(2k|qhd)\b/.test(text)) return 1440;
  const progressive = [...text.matchAll(/(\d{3,4})\s*p\b/g)].map((match) => Number(match[1]));
  const dimensions = [...text.matchAll(/(\d{3,4})\s*[x×]\s*(\d{3,4})/g)].flatMap((match) => [Number(match[1]), Number(match[2])]);
  const values = [...progressive, ...dimensions].filter((value) => value >= 144 && value <= 4320);
  if (values.length > 0) return Math.max(...values);
  if (/\bfhd\b/.test(text)) return 1080;
  if (/\bhd\b/.test(text)) return 720;
  if (/\bsd\b/.test(text)) return 480;
  return 0;
}

function inferMimeType(kind: 'video' | 'audio', format: string): string {
  const normalized = format.toLowerCase();
  if (kind === 'audio') {
    if (normalized === 'mp3') return 'audio/mpeg';
    if (normalized === 'm4a' || normalized === 'aac') return 'audio/mp4';
    if (normalized === 'ogg' || normalized === 'opus') return 'audio/ogg';
    if (normalized === 'wav') return 'audio/wav';
    if (normalized === 'flac') return 'audio/flac';
    return 'application/octet-stream';
  }
  if (normalized === 'webm') return 'video/webm';
  if (normalized === 'mov') return 'video/quicktime';
  if (normalized === 'mp4' || normalized === 'm4v') return 'video/mp4';
  if (normalized === 'mkv') return 'video/x-matroska';
  if (normalized === 'avi') return 'video/x-msvideo';
  if (normalized === 'ts') return 'video/mp2t';
  return 'application/octet-stream';
}

function formatFromMimeType(mimeType: string): string {
  const mime = mimeType.split(';', 1)[0].trim().toLowerCase();
  const formats: Record<string, string> = {
    'audio/aac': 'aac',
    'audio/flac': 'flac',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/x-matroska': 'mkv',
    'video/x-msvideo': 'avi',
    'video/mp2t': 'ts',
  };
  return formats[mime] ?? '';
}

export function normalizeMedia(media: Media): NormalizedMedia | null {
  const rawUrl = media.url?.trim();
  if (!rawUrl) return null;
  let url = rawUrl;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'https:';
      url = parsed.toString();
    } else if (parsed.protocol !== 'https:') {
      return null;
    }
  } catch {
    return null;
  }

  const rawFormat = (media.format ?? '').trim().toLowerCase();
  const urlExtension = extensionFromUrl(url);
  const descriptor = `${rawFormat} ${media.label ?? ''} ${media.mimeType ?? ''} ${urlExtension}`.toLowerCase();
  const mime = (media.mimeType ?? '').toLowerCase();
  const label = (media.label ?? '').toLowerCase();
  const kind: 'video' | 'audio' = media.kind
    ?? (mime.startsWith('audio/') || /\b(audio|sound|mp3|m4a|aac|opus|ogg|wav|flac)\b/.test(`${rawFormat} ${label}`) ? 'audio' : 'video');

  const formatFromText = KNOWN_FORMATS.find((candidate) => new RegExp(`(^|[^a-z0-9])${candidate}([^a-z0-9]|$)`, 'i').test(`${rawFormat} ${label}`));
  const formatFromMime = formatFromMimeType(mime);
  const format = formatFromText || (KNOWN_FORMATS.includes(urlExtension) ? urlExtension : '') || formatFromMime || 'unknown';

  const hasAudio = kind === 'audio'
    ? true
    : /video\s*only|no\s*audio|without\s*audio|mute(d)?/i.test(descriptor)
      ? false
      : media.hasAudio ?? null;

  return {
    ...media,
    url,
    label: media.label?.trim() || (kind === 'audio' ? format.toUpperCase() : 'Video'),
    format,
    fileSize: Number.isFinite(media.fileSize) && Number(media.fileSize) > 0 ? Number(media.fileSize) : null,
    sizeStr: media.sizeStr?.trim() || null,
    kind,
    mimeType: mime.startsWith('video/') || mime.startsWith('audio/') ? mime : inferMimeType(kind, format),
    quality: media.quality && media.quality > 0 ? media.quality : qualityFromText(descriptor),
    hasAudio,
  };
}

export function compareMediaQuality(a: NormalizedMedia, b: NormalizedMedia): number {
  if (a.kind !== b.kind) return a.kind === 'video' ? -1 : 1;
  if (a.kind === 'video' && a.hasAudio !== b.hasAudio) {
    if (a.hasAudio === false) return 1;
    if (b.hasAudio === false) return -1;
  }
  if (a.quality !== b.quality) return b.quality - a.quality;
  return (b.fileSize ?? 0) - (a.fileSize ?? 0);
}

export function normalizeVideoData(data: VideoData): NormalizedVideoData {
  const seen = new Set<string>();
  const seenVideoQualities = new Set<string>();
  const medias = data.medias
    .map(normalizeMedia)
    .filter((media): media is NormalizedMedia => Boolean(media))
    .filter((media) => {
      if (seen.has(media.url)) return false;
      seen.add(media.url);
      return true;
    })
    .sort(compareMediaQuality)
    .filter((media) => {
      if (media.kind !== 'video' || media.quality <= 0) return true;
      const key = `${media.kind}:${media.format}:${media.quality}:${media.hasAudio === false ? 'silent' : 'audio'}`;
      if (seenVideoQualities.has(key)) return false;
      seenVideoQualities.add(key);
      return true;
    });

  return { ...data, medias };
}
