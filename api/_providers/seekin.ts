import { createHash } from 'node:crypto';
import type { Provider } from '../_shared/provider.js';
import type { VideoData } from '../_shared/types.js';

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

    const medias = (payload.data.medias ?? []).filter((m) => !m.url.includes('googlevideo.com'));
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
