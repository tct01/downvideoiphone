/**
 * /api/video — Vercel Serverless Function
 *
 * Entry point duy nhất mà frontend gọi để phân tích link video.
 * Đóng vai trò orchestrator: thử lần lượt các provider cho đến khi thành công.
 *
 * Thứ tự ưu tiên: Seekin → GenDownload → Snap-Video
 *
 * Để thêm provider mới:
 * 1. Tạo file trong api/_providers/
 * 2. Import và thêm vào mảng PROVIDERS bên dưới
 */
export const maxDuration = 60;

import { seekinProvider } from './_providers/seekin.js';
import { gendownloadProvider } from './_providers/gendownload.js';
import { snapVideoProvider } from './_providers/snap-video.js';
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
];

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
    const rawData = await tryProviders(PROVIDERS, normalizedLink);
    const normalized = normalizeVideoData(rawData);
    const data = {
      ...normalized,
      medias: normalized.medias.map((media) => ({ ...media, ...signMediaUrl(media.url) })),
    };

    // Chọn video MP4 chất lượng tốt nhất
    const best = pickBestMp4(data.medias ?? []);
    if (!best) {
      return json({ error: 'Không tìm thấy định dạng video phù hợp.' }, 404);
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
    return json({ error: 'Không tìm thấy video có thể tải từ liên kết này.' }, 404);
  }
}
