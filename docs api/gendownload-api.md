# GenDownload API

A simple REST API to extract download links and info from 1,600+ sites. JSON in, JSON out — no SDK required. Base URL: https://gendownload.com

## Conventions

- **Free & open**: no API key, no account, and no rate limits — just call the endpoints.
- **Format**: all requests and responses are JSON (`Content-Type: application/json`).
- **CORS**: enabled, so you can call it directly from the browser or a server.

## POST /api/extract

Get a clean list of download options for a video URL. Each format URL is a ready-to-use download link (direct CDN for some platforms, or a streaming link for others).

### Body parameters

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | string | yes | The video/post URL to extract. |

### Example request

```bash
curl -X POST https://gendownload.com/api/extract \
  -H "Content-Type: application/json" \
  -d '{"url":"https://youtube.com/watch?v=dQw4w9WgXcQ"}'
```

### Example response

```json
{
  "title": "Never Gonna Give You Up",
  "thumbnail": "https://i.ytimg.com/vi/.../hq.jpg",
  "duration": 213,
  "source": "youtube",
  "author": "Rick Astley",
  "views": 1600000000,
  "formats": [
    { "label": "1080p", "type": "video", "ext": "mp4",
      "filesize": 52428800, "url": "https://.../api/stream?t=..&i=0" },
    { "label": "Audio", "type": "audio", "ext": "m4a",
      "filesize": 3400000, "url": "https://.../api/stream?t=..&i=6" }
  ]
}
```

## GET /api/stream

Download/stream a resolved format straight to the client (the tokenized url returned by /api/extract). Streams the file as an attachment; nothing is stored on the server.

### Example request

```bash
# open a format's url from /api/extract, e.g.
https://gendownload.com/api/stream?t=1b0bc2ea13ee&i=0
```

## POST /api/channel

List every video in a channel, playlist, or user profile. Returns an item list; download each one on demand by passing its url to /api/extract.

### Body parameters

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | string | yes | Channel / playlist / user URL. |
| `limit` | number | no | Max videos to list (default 30; use a large value for all). |

### Example request

```bash
curl -X POST https://gendownload.com/api/channel \
  -H "Content-Type: application/json" \
  -d '{"url":"https://tiktok.com/@tiktok","limit":50}'
```

### Example response

```json
{ "source": "...", "count": 50, "items": [
    { "url": "https://tiktok.com/@tiktok/video/123",
      "title": "...", "thumbnail": "https://..." }
  ] }
```

## POST /api/zip

Bundle many videos into ONE streaming .zip. POST a list of video URLs (e.g. a channel’s items) and a quality; get back a download url that streams the zip (each video is extracted and piped in on the fly — nothing is stored on the server, failed items are skipped).

### Body parameters

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `urls` | string[] | yes | Video URLs to bundle. |
| `quality` | string | no | 'best' (default), 'audio', or a max height like '720'. |

### Example request

```bash
curl -X POST https://gendownload.com/api/zip \
  -H "Content-Type: application/json" \
  -d '{"urls":["https://tiktok.com/@x/video/1","https://youtu.be/abc"],"quality":"720"}'
# -> { "url": "https://dl.gendownload.com/api/zip?t=..." }  (GET it to download)
```

### Example response

```json
{ "token": "...", "url": "https://dl.gendownload.com/api/zip?t=..." }
```

## GET /api/health

Service status — backend, queue depth, and proxy pool health.

### Example request

```bash
curl https://gendownload.com/api/health
```

### Example response

```json
{ "ok": true, "queue": { "running": 3, "waiting": 0 } }
```
