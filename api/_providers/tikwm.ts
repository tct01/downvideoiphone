import type { Provider } from '../_shared/provider.js';
import type { Media, VideoData } from '../_shared/types.js';

type TikwmImage = string | { url?: string; display_url?: string };

type TikwmData = {
  title?: string;
  cover?: string;
  duration?: number | string | null;
  play?: string;
  hdplay?: string;
  wmplay?: string;
  music?: string;
  images?: TikwmImage[];
  size?: number | string | null;
  hd_size?: number | string | null;
  hdsize?: number | string | null;
  wm_size?: number | string | null;
  wmsize?: number | string | null;
};

type TikwmResponse = {
  code?: number | string;
  msg?: string;
  data?: TikwmData;
};

function isTikTokLink(link: string): boolean {
  try {
    const host = new URL(link).hostname.toLowerCase();
    return host === 'tiktok.com' || host.endsWith('.tiktok.com');
  } catch {
    return false;
  }
}

function normalizeUrl(value?: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const parsed = raw.startsWith('//') ? new URL(`https:${raw}`) : new URL(raw, 'https://tikwm.com');
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function numericSize(value?: number | string | null): number | null {
  const size = Number(value);
  return Number.isFinite(size) && size > 0 ? Math.round(size) : null;
}

function sizeLabel(value: number | null): string | null {
  if (!value) return null;
  if (value >= 1_048_576) return `${(value / 1_048_576).toFixed(2)} MB`;
  return `${(value / 1024).toFixed(2)} KB`;
}

function imageUrl(image: TikwmImage): string | null {
  if (typeof image === 'string') return normalizeUrl(image);
  return normalizeUrl(image.url ?? image.display_url);
}

function videoMedia(url: string | null, label: string, size: number | null): Media | null {
  if (!url) return null;
  return {
    url,
    label,
    format: 'mp4',
    fileSize: size,
    sizeStr: sizeLabel(size),
    kind: 'video',
    mimeType: 'video/mp4',
    hasAudio: true,
  };
}

export const tikwmProvider: Provider = {
  name: 'tikwm',
  timeoutMs: 20_000,

  async fetch(link: string): Promise<VideoData> {
    if (!isTikTokLink(link)) throw new Error('tikwm_unsupported');

    const body = new URLSearchParams({ url: link, hd: '1' });
    const response = await fetch('https://tikwm.com/api/', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://tikwm.com',
        Referer: 'https://tikwm.com/',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) throw new Error(`tikwm:${response.status}`);

    const payload = (await response.json()) as TikwmResponse;
    if (Number(payload.code) !== 0 || !payload.data) {
      throw new Error(payload.msg || 'tikwm_invalid_response');
    }

    const data = payload.data;
    const images = (Array.isArray(data.images) ? data.images : [])
      .map(imageUrl)
      .filter((url): url is string => Boolean(url));
    const medias: Media[] = [];

    if (images.length > 0) {
      images.forEach((url, index) => {
        medias.push({
          url,
          label: `Ảnh ${index + 1}`,
          format: 'jpg',
          fileSize: null,
          sizeStr: null,
          kind: 'image',
          mimeType: 'image/jpeg',
          hasAudio: false,
        });
      });
    } else {
      const candidates = [
        videoMedia(normalizeUrl(data.hdplay), 'HD · Không watermark', numericSize(data.hd_size ?? data.hdsize)),
        videoMedia(normalizeUrl(data.play), 'Không watermark', numericSize(data.size)),
        videoMedia(normalizeUrl(data.wmplay), 'Có watermark', numericSize(data.wm_size ?? data.wmsize)),
      ];
      const seen = new Set<string>();
      for (const media of candidates) {
        if (!media || seen.has(media.url)) continue;
        seen.add(media.url);
        medias.push(media);
      }
    }

    const musicUrl = normalizeUrl(data.music);
    if (musicUrl) {
      medias.push({
        url: musicUrl,
        label: 'Audio · MP3',
        format: 'mp3',
        fileSize: null,
        sizeStr: null,
        kind: 'audio',
        mimeType: 'audio/mpeg',
        hasAudio: true,
      });
    }

    if (medias.length === 0) throw new Error('no_media');

    return {
      title: data.title,
      imageUrl: normalizeUrl(data.cover) ?? images[0],
      duration: data.duration != null ? String(data.duration) : null,
      medias,
    };
  },
};
