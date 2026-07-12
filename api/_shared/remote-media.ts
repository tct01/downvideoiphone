const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

export function isSafeMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function getRefererForUrl(urlStr: string): string | null {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    if (host.includes('googlevideo.com') || host.includes('youtube.com')) return 'https://www.youtube.com/';
    if (host.includes('xiaohongshu.com') || host.includes('xhscdn.com')) return 'https://www.xiaohongshu.com/';
    if (host.includes('bilibili.com') || host.includes('bilivideo.com')) return 'https://www.bilibili.com/';
    if (host.includes('tiktokcdn.com') || host.includes('tokcdn.com') || host.includes('byteoversea.com') || host.includes('ibytedtos.com')) return 'https://www.tiktok.com/';
    if (host.includes('douyinvod.com')) return 'https://www.douyin.com/';
    if (host.includes('instagram.com') || host.includes('cdninstagram.com')) return 'https://www.instagram.com/';
    if (host.includes('fbcdn.net') || host.includes('facebook.com')) return 'https://www.facebook.com/';
    if (host.includes('twimg.com')) return 'https://x.com/';
    if (host.includes('kwai.com') || host.includes('kwai.net') || host.includes('kwaicdn.com')) return 'https://www.kwai.com/';
  } catch {
    // Provider mới không có referer riêng vẫn được phép thử.
  }
  return null;
}

export async function fetchRemoteMedia(initialUrl: string, range: string | null, timeoutMs = 20_000): Promise<Response> {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
    if (!isSafeMediaUrl(currentUrl)) throw new Error('Media URL is not safe');
    const headers = new Headers({ 'User-Agent': USER_AGENT });
    if (range) headers.set('Range', range);
    const referer = getRefererForUrl(currentUrl);
    if (referer) headers.set('Referer', referer);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(currentUrl, { headers, redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) return response;
    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error('Too many redirects');
}

export async function probeMediaUrl(url: string): Promise<'available' | 'unavailable' | 'unknown'> {
  try {
    const response = await fetchRemoteMedia(url, 'bytes=0-0', 6_000);
    const status = response.status;
    await response.body?.cancel();
    if (status >= 200 && status < 400) return 'available';
    if (status >= 400 && status < 600) return 'unavailable';
    return 'unknown';
  } catch {
    return 'unavailable';
  }
}
