import type { Provider } from '../_shared/provider.js';
import type { Media, VideoData } from '../_shared/types.js';

/**
 * Provider: GenDownload (gendownload.com/api/extract)
 *
 * Response trả về dạng:
 * { title, thumbnail, duration (number), formats: [{ label, type, ext, filesize, url }] }
 *
 * Cần map từ `formats[]` sang `Media[]` vì schema khác hoàn toàn.
 */

type GenDownloadFormat = {
  label?: string;
  type?: string;
  ext?: string;
  filesize?: number;
  url: string;
};

type GenDownloadResponse = {
  title?: string;
  thumbnail?: string;
  duration?: number;
  formats?: GenDownloadFormat[];
};

export const gendownloadProvider: Provider = {
  name: 'gendownload',
  timeoutMs: 25_000,

  async fetch(link: string): Promise<VideoData> {
    const response = await fetch('https://gendownload.com/api/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: 'https://gendownload.com/',
      },
      body: JSON.stringify({ url: link }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) throw new Error(`gendownload:${response.status}`);

    const gd = (await response.json()) as GenDownloadResponse;

    if (!gd.formats || gd.formats.length === 0) {
      throw new Error('no_media');
    }

    // Map từ schema GenDownload → schema chung Media[]
    const medias: Media[] = gd.formats
      .filter((f) => !f.url.includes('googlevideo.com'))
      .map((f) => ({
        url: f.url,
        label: f.label ?? null,
        format: f.type === 'audio' ? (f.ext ?? 'audio') : (f.ext ?? 'mp4'),
        fileSize: f.filesize ?? null,
        sizeStr: f.filesize
          ? `${(f.filesize / 1_048_576).toFixed(1)} MB`
          : null,
      }));

    if (medias.length === 0) {
      throw new Error('no_media');
    }

    return {
      title: gd.title,
      imageUrl: gd.thumbnail,
      duration: gd.duration != null ? String(gd.duration) : null,
      medias,
    };
  },
};
