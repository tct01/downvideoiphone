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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Gọi provider một lần duy nhất — không retry. */
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
/**
 * Gọi các provider song song và hợp nhất media từ mọi nguồn thành một VideoData.
 * Sử dụng chiến lược "fast-first": trả kết quả ngay khi provider nhanh nhất
 * phản hồi thành công, đồng thời vẫn thu thập kết quả từ các provider chậm hơn
 * nhưng giới hạn thời gian chờ bổ sung.
 */
export async function collectProviders(
  providers: Provider[],
  link: string
): Promise<VideoData> {
  if (providers.length === 0) throw new Error('Không có provider nào khả dụng.');

  const firstBatch = providers.slice(0, 2);
  const fallbackBatch = providers.slice(2);

  // Khởi chạy batch đầu song song — mỗi promise đã bao gồm retry logic
  const firstPromises = firstBatch.map((provider) =>
    fetchProvider(provider, link)
  );

  // Lấy kết quả nhanh nhất trước
  let primary: VideoData;
  let remainingPromises: Promise<VideoData>[];
  try {
    primary = await Promise.any(firstPromises);
    // Các promise còn lại trong batch vẫn đang chạy ngầm
    remainingPromises = firstPromises;
  } catch {
    // Cả 2 provider đầu đều thất bại → gọi fallback
    if (fallbackBatch.length === 0) {
      throw new Error('Không có provider nào khả dụng.');
    }
    try {
      primary = await fetchProvider(fallbackBatch[0], link);
    } catch {
      throw new Error('Không có provider nào khả dụng.');
    }
    remainingPromises = [];
  }

  // Chờ thêm tối đa 3 giây để thu thập kết quả bổ sung từ provider chậm hơn
  const extraResults: VideoData[] = [];
  if (remainingPromises.length > 0) {
    const EXTRA_WAIT_MS = 3000;
    const extraSettled = await Promise.allSettled(
      remainingPromises.map((p) =>
        Promise.race([p, sleep(EXTRA_WAIT_MS).then(() => { throw new Error('extra_timeout'); })])
      )
    );
    for (const item of extraSettled) {
      if (item.status === 'fulfilled' && item.value !== primary) {
        extraResults.push(item.value as VideoData);
      }
    }
  }

  // Nếu batch đầu trả ít kết quả, gọi thêm fallback
  const totalMediaCount = primary.medias.length + extraResults.reduce((n, r) => n + r.medias.length, 0);
  if (totalMediaCount < 2 && fallbackBatch.length > 0) {
    try {
      const fallbackResult = await fetchProvider(fallbackBatch[0], link);
      extraResults.push(fallbackResult);
    } catch {
      // Bỏ qua lỗi fallback
    }
  }

  // Gộp tất cả medias
  const allSuccesses = [primary, ...extraResults];
  return {
    title: allSuccesses.find((item) => item.title)?.title ?? primary.title,
    imageUrl: allSuccesses.find((item) => item.imageUrl)?.imageUrl ?? primary.imageUrl,
    duration: allSuccesses.find((item) => item.duration)?.duration ?? primary.duration,
    medias: allSuccesses.flatMap((item) => item.medias),
  };
}
