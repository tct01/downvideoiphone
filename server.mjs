import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const port = Number(process.env.PORT || 5173);
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon' };
const allowedDomains = ['tiktokcdn.com', 'tokcdn.com', 'byteoversea.com', 'ibytedtos.com', 'douyinvod.com', 'facebook.com', 'fbcdn.net', 'instagram.com', 'cdninstagram.com', 'googlevideo.com', 'youtube.com', 'twimg.com', 'bilibili.com', 'bilivideo.com', 'kwai.com', 'kwai.net', 'kwaicdn.com', 'xiaohongshu.com', 'xhscdn.com'];

function isAllowedMediaUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function fetchAllowedMedia(initialUrl, range) {
  let currentUrl = initialUrl;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    if (!isAllowedMediaUrl(currentUrl)) throw new Error('Media host is not allowed');
    const headers = { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' };
    if (range) headers.Range = range;
    const response = await fetch(currentUrl, { headers, redirect: 'manual', signal: AbortSignal.timeout(25_000) });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) return response;
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new Error('Too many redirects');
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (requestUrl.pathname === '/api/media') {
    const mediaUrl = requestUrl.searchParams.get('url');
    const inline = requestUrl.searchParams.get('inline') === '1';
    if (!mediaUrl || !isAllowedMediaUrl(mediaUrl)) {
      sendJson(res, 400, { error: 'URL video không hợp lệ hoặc không được hỗ trợ.' });
      return;
    }

    try {
      const upstream = await fetchAllowedMedia(mediaUrl, req.headers.range);
      if (!upstream.ok || !upstream.body) {
        sendJson(res, upstream.status || 502, { error: 'Không thể lấy video từ CDN.' });
        return;
      }
      const contentType = upstream.headers.get('content-type') || 'video/mp4';
      if (!contentType.startsWith('video/') && !contentType.startsWith('application/octet-stream')) {
        await upstream.body.cancel();
        sendJson(res, 502, { error: 'CDN không trả về tệp video.' });
        return;
      }
      const headers = { 'Content-Type': contentType, 'Cache-Control': 'private, no-store', 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="clipsave-video.mp4"`, 'X-Content-Type-Options': 'nosniff' };
      for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
        const value = upstream.headers.get(name);
        if (value) headers[name] = value;
      }
      res.writeHead(upstream.status, headers);
      Readable.fromWeb(upstream.body).pipe(res);
    } catch {
      sendJson(res, 502, { error: 'Proxy không thể kết nối đến CDN video.' });
    }
    return;
  }

  const safePath = normalize(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname).replace(/^([/\\])+/, '');
  const filePath = join(root, safePath);
  const fallback = join(root, 'index.html');
  const target = filePath.startsWith(root) && existsSync(filePath) && statSync(filePath).isFile() ? filePath : fallback;
  const extension = extname(target).toLowerCase();
  res.writeHead(200, { 'Content-Type': mimeTypes[extension] || 'application/octet-stream', 'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  createReadStream(target).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`ClipSave server listening at http://127.0.0.1:${port}`));
