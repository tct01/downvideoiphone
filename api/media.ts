import { verifyMediaToken } from './_shared/media-token.js';
import { fetchRemoteMedia, isSafeMediaUrl } from './_shared/remote-media.js';

/**
 * /api/media — Vercel Serverless Function
 *
 * Proxy stream media từ CDN bên thứ 3, giải quyết vấn đề CORS trên Safari.
 * Chỉ cho phép các domain nằm trong danh sách whitelist.
 */
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const mediaUrl = requestUrl.searchParams.get('url');
  const inline = requestUrl.searchParams.get('inline') === '1';
  const requestedMime = requestUrl.searchParams.get('mime');
  const proxyToken = requestUrl.searchParams.get('token');
  const proxyExpires = requestUrl.searchParams.get('expires');

  if (!mediaUrl || !isSafeMediaUrl(mediaUrl)) {
    return Response.json({ error: 'URL media không hợp lệ hoặc không được hỗ trợ.' }, { status: 400 });
  }
  if (!verifyMediaToken(mediaUrl, proxyToken, proxyExpires)) {
    return Response.json({ error: 'Liên kết tải đã hết hạn hoặc không hợp lệ.' }, { status: 403 });
  }

  try {
    const upstream = await fetchRemoteMedia(mediaUrl, request.headers.get('range'));
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: 'Không thể tải media. Vui lòng thử lại.' }, { status: upstream.status || 502 });
    }

    const upstreamType = (upstream.headers.get('content-type') || 'application/octet-stream').split(';', 1)[0].trim().toLowerCase();
    const safeRequestedMime = requestedMime && /^(video|audio|image)\/[a-z0-9.+-]+$/i.test(requestedMime) ? requestedMime.toLowerCase() : null;
    const genericUpstreamTypes = new Set(['application/octet-stream', 'binary/octet-stream', 'application/binary', 'application/download']);
    const contentType = genericUpstreamTypes.has(upstreamType) && safeRequestedMime ? safeRequestedMime : upstreamType;
    if (!contentType.startsWith('video/') && !contentType.startsWith('audio/') && !contentType.startsWith('image/') && !contentType.startsWith('application/octet-stream')) {
      await upstream.body.cancel();
      return Response.json({ error: 'Không thể tải media. Vui lòng thử lại.' }, { status: 502 });
    }

    const extensionByMime: Record<string, string> = {
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/webm': 'webm',
      'audio/ogg': 'ogg',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/heic': 'heic',
      'image/heif': 'heic',
      'image/avif': 'avif',
    };
    const downloadExtension = extensionByMime[contentType] ?? (contentType.startsWith('audio/') ? 'audio' : contentType.startsWith('image/') ? 'jpg' : 'video');
    const headers = new Headers({
      'Content-Type': contentType,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="clipsave-media.${downloadExtension}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    console.error('Media proxy stream error:', err);
    return Response.json({ error: 'Không thể tải media. Vui lòng thử lại.' }, { status: 502 });
  }
}
