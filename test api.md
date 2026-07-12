# Snap-Video API — Tài liệu tổng hợp

> **Base URL:** `https://api.snap-video.com`
> **Phân tích từ:** HAR capture ngày 12/07/2026
> **CORS:** Chỉ cho phép `Origin: https://snap-video.com`

---

## Tổng quan luồng hoạt động

API có **2 luồng** tuỳ nền tảng:

```
Luồng A — Direct Link (Facebook, một số nền tảng khác)
  POST /api/get-info  →  trả thẳng direct_link trong videos[]

Luồng B — Render Job (TikTok, Douyin, v.v.)
  POST /api/get-info  →  direct_link = "" (cần render)
       ↓
  POST /api/mux/start  →  { job_id, status: "processing" }
       ↓ polling với setTimeout mỗi ~2 giây
  GET  /api/mux/status/{job_id}  →  { status: "completed", url: "/api/mux/download/{job_id}" }
       ↓
  GET  /api/mux/download/{job_id}?token=  →  stream file MP4
```

---

## 1. POST `/api/get-info`

Lấy thông tin video và danh sách format.

### Request

```http
POST https://api.snap-video.com/api/get-info
Content-Type: application/json
Origin: https://snap-video.com
Referer: https://snap-video.com/
```

**Body:**

```json
{ "url": "https://www.tiktok.com/@user/video/123456789" }
```

### Response — cấu trúc chung

```json
{
  "title": "149,2K views_@binhanndayne_Có lẽ ông trời…",
  "thumbnail_url": "https://p16-common-sign.tiktokcdn.com/…",
  "preview_url": "https://v16-webapp-prime.tiktok.com/…",
  "duration": "0:18",
  "uploader": "binhanndayne",
  "description": "Có lẽ ông trời cho mình nên duyên #binhan #fyp",
  "is_tiktok": true,
  "affiliate_link": "https://s.shopee.vn/7Ab4NjZGdT",
  "videos": [],
  "audios": []
}
```

### Schema `videos[]`

| Field        | Type    | Mô tả                                                                |
|--------------|---------|----------------------------------------------------------------------|
| `format_id`  | string  | ID format, truyền vào `/api/mux/start`                               |
| `resolution` | string  | `"WxH"` — ví dụ `"1080x1920"` (chỉ có ở TikTok)                   |
| `label`      | string  | `"FHD"` / `"HD"` / `"SD"` / `"Audio"`                              |
| `is_render`  | boolean | `true` = cần render job; `false` = có thể có direct_link            |
| `direct_link`| string  | URL tải trực tiếp — **rỗng `""` khi cần render**                   |
| `size_bytes` | number  | Kích thước bytes (`null` nếu chưa biết)                             |
| `size_text`  | string  | `"2.6 MB"` hoặc `""`                                                |
| `vcodec`     | string  | `"H264"` / `"H265"` (chỉ TikTok có trường này)                     |
| `ext`        | string  | `"MP4"` / `"M4A"` / `"MP3"`                                        |

### Schema `audios[]`

| Field        | Type    | Mô tả                                         |
|--------------|---------|-----------------------------------------------|
| `format_id`  | string  | `"extract_audio_m4a_128"` / `"extract_audio_mp3_128"` |
| `ext`        | string  | `"M4A"` / `"MP3"`                             |
| `quality`    | string  | `"128 kbps"`                                  |
| `is_render`  | boolean | TikTok audio luôn `true`                      |
| `direct_link`| string  | Facebook audio có thể có link GenDownload       |

---

### Ví dụ thực tế — Luồng A: Facebook (direct link)

**Request body:** `{ "url": "https://www.facebook.com/share/r/199CzwEDrL/" }`

**Response `videos[]`:**
```json
[
  {
    "format_id": "HD",  "ext": "MP4",  "quality": "HD",
    "is_render": false,
    "direct_link": "https://video-xxc1-1.xx.fbcdn.net/o1/v/t2/…&dl=1",
    "size_bytes": null
  },
  {
    "format_id": "SD",  "ext": "MP4",  "quality": "SD",
    "is_render": false,
    "direct_link": "https://video-xxc1-1.xx.fbcdn.net/o1/v/t2/…&dl=1",
    "size_bytes": null
  }
]
```
→ Dùng `direct_link` trực tiếp, không cần render.

---

### Ví dụ thực tế — Luồng B: TikTok (cần render)

**Response `videos[]`:**
```json
[
  { "format_id": "bytevc1_1080p_1229208-0", "label": "FHD", "is_render": false, "direct_link": "", "size_bytes": 2776013 },
  { "format_id": "bytevc1_720p_651962-0",   "label": "HD",  "is_render": false, "direct_link": "", "size_bytes": 1472376 },
  { "format_id": "h264_540p_1159183-0",     "label": "SD",  "is_render": false, "direct_link": "", "size_bytes": 2617870 }
]
```

> ⚠️ **Đặc thù TikTok:** `is_render = false` nhưng `direct_link = ""` — vẫn phải gọi render job.
> **Quy tắc an toàn:** Chỉ dùng direct link khi `direct_link !== ""`, bỏ qua `is_render`.

---

## 2. POST `/api/mux/start`

Khởi tạo render job.

### Request

```http
POST https://api.snap-video.com/api/mux/start
Content-Type: application/json
Origin: https://snap-video.com
x-vip-token: ""
```

**Body:**
```json
{
  "url": "https://www.tiktok.com/@user/video/123456789",
  "format_id": "bytevc1_1080p_1229208-0",
  "title": "149,2K views_@binhanndayne_Có lẽ ông trời…"
}
```

| Field      | Required | Mô tả                                    |
|------------|----------|------------------------------------------|
| `url`      | ✅       | URL video gốc                            |
| `format_id`| ✅       | Lấy từ `videos[].format_id` ở get-info   |
| `title`    | ✅       | `title` từ get-info response (đặt tên file) |

> Header `x-vip-token: ""` — bắt buộc phải có dù để trống.

### Response

```json
{
  "job_id": "job-1783835772-e3cfc0",
  "status": "processing"
}
```

---

## 3. GET `/api/mux/status/{job_id}`

Poll trạng thái render (mỗi ~2 giây).

```http
GET https://api.snap-video.com/api/mux/status/job-1783835772-e3cfc0
Origin: https://snap-video.com
```

### Response — đang xử lý
```json
{ "status": "processing", "progress": 50, "url": "", "error": "" }
```

### Response — hoàn tất
```json
{
  "status": "completed",
  "progress": 100,
  "url": "/api/mux/download/job-1783835772-e3cfc0",
  "error": "",
  "filename": "149,2K views_@binhanndayne_Có lẽ ông trờ_job-1783835772-e3cfc0.mp4",
  "created_at": 1783835772.5000563,
  "finished_at": 1783835773.7913582
}
```

| Field        | Mô tả                                            |
|--------------|--------------------------------------------------|
| `status`     | `"processing"` / `"completed"` / `"error"`       |
| `progress`   | 0–100                                            |
| `url`        | Relative path download (rỗng khi đang xử lý)    |
| `filename`   | Tên file đề xuất                                 |
| `finished_at`| Unix timestamp (float)                           |

---

## 4. GET `/api/mux/download/{job_id}`

Stream file MP4 đã render. Hỗ trợ `HEAD` và `GET`, hỗ trợ `Range` bytes.

```http
GET https://api.snap-video.com/api/mux/download/job-1783835772-e3cfc0?token=
Origin: https://snap-video.com
```

**Response headers quan trọng:**
```
Content-Type: video/mp4
Content-Length: 2776013
Content-Disposition: attachment; filename*=utf-8''149%2C2K%20views_….mp4
Accept-Ranges: bytes
ETag: "d3aa01d619f9333f82fab4beb2e093c0"
```

> `?token=` — để trống với free tier. VIP token có thể mở chức năng cao hơn.

---

## 5. GET `/api/sponsored-products`

Danh sách quảng cáo affiliate (Shopee). Không liên quan tải video.

```json
{
  "status": "success",
  "data": [
    { "title": "…", "image": "https://down-vn.img.susercontent.com/…", "link": "https://s.shopee.vn/…" }
  ]
}
```

---

## Logic tích hợp đề xuất

```
1. POST /api/get-info { url }
2. Chọn format video tốt nhất:
   - Ưu tiên: label FHD > HD > SD
   - Tiebreaker: size_bytes lớn hơn
3. Kiểm tra:
   IF video.direct_link !== ""
     → Dùng direct_link trực tiếp (Luồng A)
   ELSE
     → POST /api/mux/start { url, format_id, title }
     → Lấy job_id
     → Poll GET /api/mux/status/{job_id} mỗi 2 giây
     → Khi status = "completed":
         download_url = "https://api.snap-video.com" + status.url + "?token="
```

---

## Thông tin kỹ thuật

| Hạ tầng              | Cloudflare, cụm SIN (Singapore), HTTP/3 |
|----------------------|-----------------------------------------|
| Content-Encoding     | `zstd`                                  |
| Thời gian get-info   | ~850ms (TikTok) / ~320ms (Facebook)     |
| Thời gian render TikTok | ~1.3 giây (job tạo → xong)           |
| Polling interval     | ~2 giây (setTimeout trong source code)  |
| VIP header           | `x-vip-token` trong mux/start request   |