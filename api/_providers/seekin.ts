import { createHash } from 'node:crypto';
import type { Provider } from '../_shared/provider.js';
import type { Media, VideoData } from '../_shared/types.js';

/**
 * Provider: Seekin.ai (api.seekin.ai/ikool/media/download)
 *
 * Cơ chế xác thực: SHA-256 signature
 * Công thức: sign = SHA256( lang + timestamp + SECRET_KEY + "url=" + videoUrl )
 *
 * Response trả về dạng:
 * { code: "0000", data: { title, imageUrl, medias: [{ url, label, format, fileSize, sizeStr }] } }
 */

const SECRET_KEY = '3HT8hjE79L';
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav', 'weba']);
const VIDEO_EXTENSIONS = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'ts', 'webm']);
const KNOWN_EXTENSIONS = new Set([...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS]);

function extensionFromMime(mimeType?: string | null): string | null {
  const mime = (mimeType ?? '').split(';', 1)[0].trim().toLowerCase();
  const byMime: Record<string, string> = {
    'audio/aac': 'aac',
    'audio/flac': 'flac',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
    'audio/webm': 'weba',
    'audio/wav': 'wav',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
  };
  return byMime[mime] ?? null;
}

function extensionFromUrl(value: string): string | null {
  try {
    const extension = new URL(value).pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1] ?? '';
    return KNOWN_EXTENSIONS.has(extension) ? extension : null;
  } catch {
    return null;
  }
}

function mimeFromExtension(extension: string, kind: 'video' | 'audio'): string {
  if (kind === 'audio') {
    if (extension === 'm4a' || extension === 'aac') return 'audio/mp4';
    if (extension === 'ogg' || extension === 'opus') return 'audio/ogg';
    if (extension === 'weba' || extension === 'webm') return 'audio/webm';
    if (extension === 'wav') return 'audio/wav';
    if (extension === 'flac') return 'audio/flac';
    return 'audio/mpeg';
  }
  if (extension === 'webm') return 'video/webm';
  if (extension === 'mov') return 'video/quicktime';
  return 'video/mp4';
}

function parseFileSize(size: string): number | null {
  const match = size.match(/([\d.]+)\s*(B|KB|MB|GB)/i);
  if (!match) return null;
  const value = Number(match[1]);
  const multiplier = { B: 1, KB: 1024, MB: 1_048_576, GB: 1_073_741_824 }[match[2].toUpperCase() as 'B' | 'KB' | 'MB' | 'GB'];
  return Number.isFinite(value) ? Math.round(value * multiplier) : null;
}

function normalizeSeekinMedia(media: Media): Media {
  const descriptor = media.format?.trim() ?? '';
  const bracketExtension = descriptor.match(/\[\s*\.?([a-z0-9]+)\s*\]/i)?.[1]?.toLowerCase();
  const plainExtension = [...KNOWN_EXTENSIONS].find((candidate) => new RegExp(`(^|[^a-z0-9])${candidate}([^a-z0-9]|$)`, 'i').test(descriptor));
  const detectedExtension = (bracketExtension && KNOWN_EXTENSIONS.has(bracketExtension) ? bracketExtension : null)
    || plainExtension
    || extensionFromMime(media.mimeType)
    || extensionFromUrl(media.url);
  const sizeStr = descriptor.match(/[\[(]\s*([\d.]+\s*(?:B|KB|MB|GB))\s*[\])]/i)?.[1]?.toUpperCase();
  const qualityLabel = descriptor.match(/\b(4K|2K|\d{3,4}p|FHD|HD|SD)\b/i)?.[1];
  const isAudio = media.kind === 'audio'
    || (media.mimeType ?? '').toLowerCase().startsWith('audio/')
    || Boolean(detectedExtension && AUDIO_EXTENSIONS.has(detectedExtension))
    || /\b(audio|sound)\b/i.test(`${descriptor} ${media.label ?? ''}`);
  const kind: 'video' | 'audio' = isAudio ? 'audio' : 'video';
  // Seekin documents Douyin downloads as MP4. Some Douyin responses omit [.mp4],
  // so an otherwise unknown video must not leak out as application/octet-stream.
  const extension = detectedExtension || (isAudio ? 'mp3' : 'mp4');
  const format = extension === 'weba' ? 'webm' : extension;
  const displayFormat = format?.toUpperCase();
  const declaredMime = (media.mimeType ?? '').split(';', 1)[0].trim().toLowerCase();
  const mimeType = declaredMime.startsWith('video/') || declaredMime.startsWith('audio/')
    ? declaredMime
    : mimeFromExtension(extension, kind);

  return {
    ...media,
    label: media.label?.trim() || (isAudio
      ? `Audio${displayFormat ? ` · ${displayFormat}` : ''}`
      : [qualityLabel, displayFormat].filter(Boolean).join(' · ') || 'Video'),
    format: format || media.format,
    fileSize: media.fileSize ?? (sizeStr ? parseFileSize(sizeStr) : null),
    sizeStr: media.sizeStr?.trim() || sizeStr || null,
    kind,
    mimeType,
  };
}

function generateSignature(videoUrl: string, timestamp: string, lang = 'en'): string {
  const sortedParams = `url=${videoUrl}`;
  const stringToSign = `${lang}${timestamp}${SECRET_KEY}${sortedParams}`;
  return createHash('sha256').update(stringToSign).digest('hex');
}

export const seekinProvider: Provider = {
  name: 'seekin',
  timeoutMs: 15_000,

  async fetch(link: string): Promise<VideoData> {
    const timestamp = Date.now().toString();
    const lang = 'en';
    const signature = generateSignature(link, timestamp, lang);

    const response = await fetch('https://api.seekin.ai/ikool/media/download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        sign: signature,
        lang,
        referer: 'https://www.seekin.ai',
        timestamp,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({ url: link }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) throw new Error(`seekin:${response.status}`);

    const payload = (await response.json()) as {
      code?: string;
      msg?: string;
      data?: VideoData;
    };

    if (payload.code !== '0000' || !payload.data) {
      throw new Error(payload.msg || 'seekin_invalid_response');
    }

    const medias = (payload.data.medias ?? []).map(normalizeSeekinMedia);
    if (medias.length === 0) throw new Error('no_media');

    // Seekin trả về đúng cấu trúc VideoData luôn — chỉ cần validate
    return {
      title: payload.data.title,
      imageUrl: payload.data.imageUrl,
      duration: payload.data.duration,
      medias,
    };
  },
};
