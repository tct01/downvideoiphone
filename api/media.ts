export const maxDuration = 300;

const ALLOWED_MEDIA_DOMAINS = [
  'tiktokcdn.com',
  'tokcdn.com',
  'byteoversea.com',
  'ibytedtos.com',
  'douyinvod.com',
  'facebook.com',
  'fbcdn.net',
  'instagram.com',
  'cdninstagram.com',
  'googlevideo.com',
  'youtube.com',
  'twimg.com',
  'bilibili.com',
  'bilivideo.com',
  'kwai.com',
  'kwai.net',
  'kwaicdn.com',
  'xiaohongshu.com',
  'xhscdn.com'
];

function isAllowedMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return ALLOWED_MEDIA_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function fetchAllowedMedia(initialUrl: string, range: string | null): Promise<Response> {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
    if (!isAllowedMediaUrl(currentUrl)) throw new Error('Media host is not allowed');

    const headers = new Headers({
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'
    });
    if (range) headers.set('Range', range);

    const response = await fetch(currentUrl, { headers, redirect: 'manual', signal: AbortSignal.timeout(25_000) });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) return response;
    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error('Too many redirects');
}

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const mediaUrl = requestUrl.searchParams.get('url');
  const inline = requestUrl.searchParams.get('inline') === '1';

  if (!mediaUrl || !isAllowedMediaUrl(mediaUrl)) {
    return Response.json({ error: 'URL video không hợp lệ hoặc không được hỗ trợ.' }, { status: 400 });
  }

  try {
    const upstream = await fetchAllowedMedia(mediaUrl, request.headers.get('range'));
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: 'Không thể lấy video từ CDN.' }, { status: upstream.status || 502 });
    }

    const contentType = upstream.headers.get('content-type') || 'video/mp4';
    if (!contentType.startsWith('video/') && !contentType.startsWith('application/octet-stream')) {
      await upstream.body.cancel();
      return Response.json({ error: 'CDN không trả về tệp video.' }, { status: 502 });
    }

    const headers = new Headers({
      'Content-Type': contentType,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="clipsave-video.mp4"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return Response.json({ error: 'Proxy không thể kết nối đến CDN video.' }, { status: 502 });
  }
}
