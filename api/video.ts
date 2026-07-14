/**
 * /api/video — Vercel Serverless Function
 *
 * Entry point duy nhất mà frontend gọi để phân tích link video.
 * Đóng vai trò orchestrator: thử lần lượt các provider cho đến khi thành công.
 *
 * Thứ tự chung: Seekin → Snap-Video → GenDownload → TikWM.
 * Riêng liên kết TikTok: Seekin → TikWM → Snap-Video → GenDownload.
 * Seekin luôn đứng đầu để giữ chất lượng video tốt nhất; TikWM đứng kế tiếp
 * làm fallback chuyên biệt cho carousel ảnh.
 * Riêng liên kết YouTube: GenDownload → Seekin → Snap-Video → TikWM.
 *
 * Để thêm provider mới:
 * 1. Tạo file trong api/_providers/
 * 2. Import và thêm vào mảng PROVIDERS bên dưới
 */
export const maxDuration = 60;

import { seekinProvider } from './_providers/seekin.js';
import { gendownloadProvider } from './_providers/gendownload.js';
import { snapVideoProvider } from './_providers/snap-video.js';
import { tikwmProvider } from './_providers/tikwm.js';
import { tryProviders } from './_shared/provider.js';
import { pickBestMp4 } from './_shared/pick-best.js';
import { normalizeVideoData } from './_shared/normalize.js';
import { signMediaUrl } from './_shared/media-token.js';
import { verifyClientSignature } from './_shared/client-signature.js';
import type { Provider } from './_shared/provider.js';

/** Danh sách providers theo thứ tự ưu tiên — thêm/bớt ở đây */
const PROVIDERS: Provider[] = [
  seekinProvider,
  snapVideoProvider,
  gendownloadProvider,
  tikwmProvider,
];

export function providersForLink(link: string): Provider[] {
  try {
    const host = new URL(link).hostname.toLowerCase();
    if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) {
      return [gendownloadProvider, seekinProvider, snapVideoProvider, tikwmProvider];
    }
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
      return [seekinProvider, tikwmProvider, snapVideoProvider, gendownloadProvider];
    }
  } catch {
    // Provider sẽ tự báo lỗi URL không hợp lệ.
  }
  return PROVIDERS;
}

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE_HEADERS });
}

export async function GET(request: Request): Promise<Response> {
  const reqUrl = new URL(request.url);
  const link = reqUrl.searchParams.get('link');

  if (!link || link.trim().length === 0) {
    return json({ error: 'Thiếu tham số link.' }, 400);
  }

  try {
    const normalizedLink = link.trim();
    const signatureValid = verifyClientSignature(
      normalizedLink,
      request.headers.get('x-clipsave-lang'),
      request.headers.get('x-clipsave-timestamp'),
      request.headers.get('x-clipsave-sign'),
    );
    if (!signatureValid) {
      return json({ error: 'Yêu cầu không hợp lệ hoặc đã hết hạn.' }, 403);
    }

    // Thử lần lượt từng provider cho đến khi thành công
    const rawData = await tryProviders(providersForLink(normalizedLink), normalizedLink);
    const normalized = normalizeVideoData(rawData);
    const data = {
      ...normalized,
      medias: normalized.medias.map((media) => ({ ...media, ...signMediaUrl(media.url) })),
    };

    // Video vẫn ưu tiên bản tốt nhất; bài carousel dùng ảnh đầu tiên làm media chính.
    const best = pickBestMp4(data.medias ?? [])
      ?? data.medias.find((media) => media.kind === 'image')
      ?? null;
    if (!best) {
      return json({ error: 'Không tìm thấy định dạng media phù hợp.' }, 404);
    }

    // Trả về dữ liệu cần thiết — không tiết lộ tên service bên thứ 3
    return json({
      title: data.title ?? null,
      imageUrl: data.imageUrl ?? null,
      duration: data.duration ?? null,
      media: best,
      medias: data.medias,
    });
  } catch (error) {
    if (error instanceof Error && (error.message.includes('MEDIA_PROXY_SECRET') || error.message.includes('CLIENT_SIGNATURE_KEY'))) {
      return json({ error: 'Máy chủ chưa được cấu hình đầy đủ.' }, 500);
    }
    return json({ error: 'Không tìm thấy nội dung có thể tải từ liên kết này.' }, 404);
  }
}
