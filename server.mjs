import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { GET as getVideo } from './api/video.ts';
import { GET as getMedia } from './api/media.ts';

const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const fileEnv = loadEnv(mode, process.cwd(), '');
for (const [name, value] of Object.entries(fileEnv)) {
  if (process.env[name] === undefined) process.env[name] = value;
}

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const port = Number(process.env.PORT || 5173);
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon' };

async function sendWebResponse(response, res) {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (!response.body) {
    res.end();
    return;
  }
  Readable.fromWeb(response.body).pipe(res);
}

function createWebRequest(req) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value != null) headers.set(name, value);
  }
  return new Request(`http://${req.headers.host || `127.0.0.1:${port}`}${req.url || '/'}`, {
    method: req.method || 'GET',
    headers,
  });
}

createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
    if (pathname === '/api/video') {
      await sendWebResponse(await getVideo(createWebRequest(req)), res);
      return;
    }
    if (pathname === '/api/media') {
      await sendWebResponse(await getMedia(createWebRequest(req)), res);
      return;
    }

    const safePath = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^([/\\])+/, '');
    const filePath = join(root, safePath);
    const fallback = join(root, 'index.html');
    const target = filePath.startsWith(root) && existsSync(filePath) && statSync(filePath).isFile() ? filePath : fallback;
    const extension = extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes[extension] || 'application/octet-stream',
      'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    createReadStream(target).pipe(res);
  } catch {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Lỗi máy chủ cục bộ.' }));
  }
}).listen(port, '127.0.0.1', () => console.log(`ClipSave server listening at http://127.0.0.1:${port}`));
