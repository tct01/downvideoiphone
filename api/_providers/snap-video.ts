import type { Provider } from '../_shared/provider.js';
import type { Media, VideoData } from '../_shared/types.js';

/**
 * Provider: Snap-Video (api.snap-video.com)
 *
 * Có 2 luồng response:
 * - Luồng A (Facebook, v.v.): direct_link có sẵn → dùng ngay
 * - Luồng B (TikTok, Douyin): direct_link rỗng → cần render job:
 *     POST /api/mux/start → poll GET /api/mux/status/{job_id} → download URL
 *
 * Lưu ý: is_render không đáng tin (TikTok trả false nhưng direct_link rỗng).
 * Quy tắc an toàn: chỉ dùng direct_link khi nó không rỗng.
 */

type SnapVideoFormat = {
  format_id: string;
  resolution?: string;
  label?: string;
  direct_link?: string;
  size_bytes?: number | null;
  ext?: string;
};

type SnapInfoResponse = {
  title?: string;
  thumbnail_url?: string;
  duration?: string | null;
  videos?: SnapVideoFormat[];
};

const SNAP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Origin: 'https://snap-video.com',
  Referer: 'https://snap-video.com/',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tính điểm ưu tiên cho format dựa trên resolution/label */
function formatScore(f: SnapVideoFormat): number {
  if (f.resolution) {
    const nums = f.resolution.match(/(\d+)/g);
    if (nums) return Math.max(...nums.map(Number));
  }
  const lbl = (f.label ?? '').toUpperCase();
  if (lbl.includes('FHD') || lbl.includes('1080')) return 1080;
  if (lbl.includes('HD') || lbl.includes('720')) return 720;
  if (lbl.includes('SD') || lbl.includes('480')) return 480;
  return 0;
}

/** Gọi render job và poll status cho đến khi hoàn tất */
async function renderAndPoll(
  link: string,
  format: SnapVideoFormat,
  title: string
): Promise<string> {
  // Bước 1: Khởi tạo render job
  const startRes = await fetch('https://api.snap-video.com/api/mux/start', {
    method: 'POST',
    headers: { ...SNAP_HEADERS, 'x-vip-token': '' },
    body: JSON.stringify({
      url: link,
      format_id: format.format_id,
      title,
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!startRes.ok) throw new Error(`snap_start:${startRes.status}`);

  const startPayload = (await startRes.json()) as {
    job_id?: string;
    status?: string;
  };
  const jobId = startPayload.job_id;
  if (!jobId) throw new Error('no_job_id');

  // Bước 2: Poll status mỗi 1.5 giây, tối đa 10 lần (~15 giây)
  for (let i = 0; i < 10; i++) {
    await sleep(1500);

    const statusRes = await fetch(
      `https://api.snap-video.com/api/mux/status/${jobId}`,
      {
        method: 'GET',
        headers: {
          Origin: 'https://snap-video.com',
          Referer: 'https://snap-video.com/',
        },
        signal: AbortSignal.timeout(8_000),
      }
    );

    if (!statusRes.ok) continue;

    const statusPayload = (await statusRes.json()) as {
      status?: string;
      url?: string;
      error?: string;
    };

    if (statusPayload.status === 'completed' && statusPayload.url) {
      return `https://api.snap-video.com${statusPayload.url}?token=`;
    }

    if (statusPayload.status === 'error') {
      throw new Error(statusPayload.error || 'render_failed');
    }
  }

  throw new Error('render_timeout');
}

export const snapVideoProvider: Provider = {
  name: 'snap-video',
  timeoutMs: 30_000, // Render job có thể mất thời gian

  async fetch(link: string): Promise<VideoData> {
    // Bước 1: Lấy thông tin video và danh sách format
    const infoRes = await fetch('https://api.snap-video.com/api/get-info', {
      method: 'POST',
      headers: SNAP_HEADERS,
      body: JSON.stringify({ url: link }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!infoRes.ok) throw new Error(`snap_info:${infoRes.status}`);

    const info = (await infoRes.json()) as SnapInfoResponse;
    const videos = info.videos ?? [];
    if (videos.length === 0) throw new Error('no_media');

    // Bước 2: Chọn format tốt nhất
    const sorted = [...videos].sort((a, b) => {
      const scoreDiff = formatScore(b) - formatScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return (b.size_bytes ?? 0) - (a.size_bytes ?? 0);
    });
    const best = sorted[0];

    // Bước 3: Xác định download URL
    let downloadUrl = (best.direct_link ?? '').trim();
    const isYouTube = link.includes('youtube.com') || link.includes('youtu.be');

    if (downloadUrl.length === 0 || isYouTube) {
      // Không có direct link hoặc là YouTube → cần render job (TikTok, Douyin, YouTube, v.v.)
      downloadUrl = await renderAndPoll(link, best, info.title ?? 'Video');
    }

    // Bước 4: Chuẩn hóa thành VideoData
    const media: Media = {
      url: downloadUrl,
      label: best.label || best.resolution || 'HD',
      format: best.ext || 'mp4',
      fileSize: best.size_bytes || null,
      sizeStr: best.size_bytes
        ? `${(best.size_bytes / 1_048_576).toFixed(1)} MB`
        : null,
    };

    return {
      title: info.title,
      imageUrl: info.thumbnail_url,
      duration: info.duration,
      medias: [media],
    };
  },
};
