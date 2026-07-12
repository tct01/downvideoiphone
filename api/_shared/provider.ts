import { probeMediaUrl } from './remote-media.js';
import type { VideoData } from './types.js';

/**
 * Interface mà mọi video provider phải implement.
 *
 * Mỗi provider chịu trách nhiệm:
 * 1. Gọi API bên thứ 3
 * 2. Parse response (mỗi bên có schema khác nhau)
 * 3. Chuẩn hóa kết quả về kiểu `VideoData` chung
 */
export interface Provider {
  /** Tên ngắn để log/debug — VD: 'seekin', 'gendownload', 'snap-video' */
  name: string;

  /** Timeout (ms) cho toàn bộ quá trình fetch của provider này */
  timeoutMs: number;

  /** Gọi API và trả về VideoData đã chuẩn hóa. Throw nếu thất bại. */
  fetch(link: string): Promise<VideoData>;
}

/** Gọi provider một lần duy nhất. */
async function fetchProvider(provider: Provider, link: string): Promise<VideoData> {
  const result = await provider.fetch(link);
  if (!result.medias || result.medias.length === 0) throw new Error('no_media');

  // Kiểm tra xem link tải chính có thực sự hoạt động hay không (tránh link hỏng/hết hạn sớm)
  const firstMedia = result.medias[0];
  if (firstMedia && firstMedia.url && !firstMedia.url.includes('googlevideo.com') && !firstMedia.url.includes('snap-video.com')) {
    try {
      const status = await probeMediaUrl(firstMedia.url);
      if (status === 'unavailable') {
        throw new Error('media_link_broken');
      }
    } catch {
      // Bỏ qua lỗi probe ngẫu nhiên để tránh chặn nhầm link tốt
    }
  }

  return result;
}

/**
 * Lặp qua danh sách providers theo thứ tự ưu tiên.
 * Trả về VideoData từ provider đầu tiên thành công.
 * Nếu tất cả đều thất bại, throw error.
 */
export async function tryProviders(
  providers: Provider[],
  link: string
): Promise<VideoData> {
  let lastError: Error | null = null;

  for (const provider of providers) {
    try {
      return await fetchProvider(provider, link);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Tiếp tục thử provider tiếp theo
    }
  }

  throw lastError ?? new Error('Không có provider nào khả dụng.');
}
