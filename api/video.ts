export const maxDuration = 60;

// Vercel Edge Runtime cung cấp process.env lúc chạy —
// khai báo kiểu thủ công để svelte-check không báo lỗi
declare const process: { env: Record<string, string | undefined> };

// Đọc endpoint từ biến môi trường, không bao giờ trả về client
const PRIMARY_ENDPOINT =
  process.env.VITE_API_ENDPOINT ||
  'https://n8n.tocongtruong.works/webhook/autodownvideo';

type Media = {
  url: string;
  label?: string | null;
  format?: string | null;
  fileSize?: number | null;
  sizeStr?: string | null;
};

type VideoData = {
  title?: string;
  imageUrl?: string;
  duration?: string | null;
  medias?: Media[];
};

// --- Nguồn 1: primary webhook ---
async function fetchFromPrimary(link: string): Promise<VideoData> {
  const url = new URL(PRIMARY_ENDPOINT);
  url.searchParams.set('link', link);
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`primary:${response.status}`);

  const payload = (await response.json()) as {
    code?: string;
    msg?: string;
    data?: VideoData;
  };
  const mediaItems = payload.data?.medias ?? [];
  if (payload.code !== '0000' || !payload.data || mediaItems.length === 0) {
    throw new Error('no_media');
  }
  return payload.data;
}

// --- Nguồn 2: fallback ---
async function fetchFromFallback(link: string): Promise<VideoData> {
  const res = await fetch('https://gendownload.com/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ url: link }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`fallback:${res.status}`);

  const gd = (await res.json()) as {
    title?: string;
    thumbnail?: string;
    duration?: number;
    formats?: Array<{
      label?: string;
      type?: string;
      ext?: string;
      filesize?: number;
      url: string;
    }>;
  };

  if (!gd.formats || gd.formats.length === 0) throw new Error('no_media');

  const medias: Media[] = gd.formats.map((f) => ({
    url: f.url,
    label: f.label ?? null,
    format:
      f.type === 'audio' ? (f.ext ?? 'audio') : (f.ext ?? 'mp4'),
    fileSize: f.filesize ?? null,
    sizeStr: f.filesize
      ? `${(f.filesize / 1_048_576).toFixed(1)} MB`
      : null,
  }));

  return {
    title: gd.title,
    imageUrl: gd.thumbnail,
    duration: gd.duration != null ? String(gd.duration) : null,
    medias,
  };
}

// --- Nguồn 3: snap-video fallback ---
type SnapVideoFormat = {
  format_id: string;
  resolution?: string;
  label?: string;
  direct_link?: string;
  size_bytes?: number | null;
  ext?: string;
};

type SnapVideoInfoResponse = {
  title?: string;
  thumbnail_url?: string;
  duration?: string | null;
  videos?: SnapVideoFormat[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchFromSnapVideo(link: string): Promise<VideoData> {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Origin: 'https://snap-video.com',
    Referer: 'https://snap-video.com/',
  };

  const infoRes = await fetch('https://api.snap-video.com/api/get-info', {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: link }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!infoRes.ok) throw new Error(`snap_info:${infoRes.status}`);

  const info = (await infoRes.json()) as SnapVideoInfoResponse;
  const videos = info.videos ?? [];
  if (videos.length === 0) throw new Error('no_media');

  const getScore = (f: SnapVideoFormat) => {
    if (f.resolution) {
      const nums = f.resolution.match(/(\d+)/g);
      if (nums) return Math.max(...nums.map(Number));
    }
    const lbl = (f.label ?? '').toUpperCase();
    if (lbl.includes('FHD') || lbl.includes('1080')) return 1080;
    if (lbl.includes('HD') || lbl.includes('720')) return 720;
    if (lbl.includes('SD') || lbl.includes('480')) return 480;
    return 0;
  };

  const sorted = [...videos].sort((a, b) => {
    const scoreDiff = getScore(b) - getScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return (b.size_bytes ?? 0) - (a.size_bytes ?? 0);
  });

  const best = sorted[0];

  let downloadUrl = best.direct_link ?? '';
  if (downloadUrl.trim().length === 0) {
    const startRes = await fetch('https://api.snap-video.com/api/mux/start', {
      method: 'POST',
      headers: {
        ...headers,
        'x-vip-token': '',
      },
      body: JSON.stringify({
        url: link,
        format_id: best.format_id,
        title: info.title ?? 'Video',
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!startRes.ok) throw new Error(`snap_start:${startRes.status}`);

    const startPayload = (await startRes.json()) as { job_id?: string; status?: string };
    const jobId = startPayload.job_id;
    if (!jobId) throw new Error('no_job_id');

    let completedUrl = '';
    for (let i = 0; i < 10; i++) {
      await sleep(1500);
      const statusRes = await fetch(`https://api.snap-video.com/api/mux/status/${jobId}`, {
        method: 'GET',
        headers: {
          Origin: 'https://snap-video.com',
          Referer: 'https://snap-video.com/',
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (!statusRes.ok) continue;

      const statusPayload = (await statusRes.json()) as { status?: string; url?: string; error?: string };
      if (statusPayload.status === 'completed' && statusPayload.url) {
        completedUrl = statusPayload.url;
        break;
      }
      if (statusPayload.status === 'error') {
        throw new Error(statusPayload.error || 'render_failed');
      }
    }

    if (!completedUrl) throw new Error('render_timeout');
    downloadUrl = `https://api.snap-video.com${completedUrl}?token=`;
  }

  return {
    title: info.title,
    imageUrl: info.thumbnail_url,
    duration: info.duration,
    medias: [
      {
        url: downloadUrl,
        label: best.label || best.resolution || 'HD',
        format: best.ext || 'mp4',
        fileSize: best.size_bytes || null,
        sizeStr: best.size_bytes
          ? `${(best.size_bytes / 1_048_576).toFixed(1)} MB`
          : null,
      },
    ],
  };
}

// --- Chọn video MP4 chất lượng tốt nhất ---
function heightFromLabel(label: string | null | undefined): number {
  const m = (label ?? '').match(/(\d{3,4})p/i);
  return m ? parseInt(m[1], 10) : 0;
}

function pickBestMp4(medias: Media[]): Media | null {
  const videoOnly = medias.filter((m) => {
    const fmt = (m.format ?? '').toLowerCase();
    return !['mp3', 'aac', 'm4a', 'opus', 'ogg', 'audio'].some((a) =>
      fmt.includes(a)
    );
  });
  if (videoOnly.length === 0) return medias[0] ?? null;
  videoOnly.sort((a, b) => {
    const sizeDiff = (b.fileSize ?? 0) - (a.fileSize ?? 0);
    if (sizeDiff !== 0) return sizeDiff;
    return heightFromLabel(b.label) - heightFromLabel(a.label);
  });
  return videoOnly[0];
}

export async function GET(request: Request): Promise<Response> {
  const reqUrl = new URL(request.url);
  const link = reqUrl.searchParams.get('link');

  if (!link || link.trim().length === 0) {
    return Response.json(
      { error: 'Thiếu tham số link.' },
      { status: 400 }
    );
  }

  let data: VideoData | null = null;

  try {
    data = await fetchFromPrimary(link.trim());
  } catch {
    try {
      data = await fetchFromFallback(link.trim());
    } catch {
      try {
        data = await fetchFromSnapVideo(link.trim());
      } catch {
        return Response.json(
          { error: 'Không tìm thấy video có thể tải từ liên kết này.' },
          { status: 404 }
        );
      }
    }
  }

  const best = pickBestMp4(data.medias ?? []);
  if (!best) {
    return Response.json(
      { error: 'Không tìm thấy định dạng video phù hợp.' },
      { status: 404 }
    );
  }

  // Chỉ trả về dữ liệu cần thiết — không tiết lộ tên service bên thứ 3
  return Response.json({
    title: data.title ?? null,
    imageUrl: data.imageUrl ?? null,
    duration: data.duration ?? null,
    media: best,
  });
}
