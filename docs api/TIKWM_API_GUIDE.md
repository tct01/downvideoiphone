# TikWM API Reference

Tài liệu này chỉ mô tả API của TikWM dùng để chuyển một URL TikTok thành dữ liệu tải xuống.

## Endpoint

- `POST https://tikwm.com/api/`
- `Content-Type: application/x-www-form-urlencoded`

## Request Parameters

| Tham số | Kiểu | Bắt buộc | Mô tả |
| :-- | :-- | :-- | :-- |
| `url` | string | Có | URL TikTok hợp lệ cần xử lý |
| `hd` | string hoặc number | Không | Đặt `1` để ưu tiên bản HD nếu có |

Ví dụ body:

```text
url=https://www.tiktok.com/@user/video/1234567890&hd=1
```

## Response

API thường trả về JSON có dạng:

```json
{
  "code": 0,
  "msg": "success",
  "data": {}
}
```

Nếu `code` khác `0`, xem `msg` để biết lỗi.

## Các Trường Thường Gặp Trong `data`

| Trường | Ý nghĩa |
| :-- | :-- |
| `play` | Link video không watermark |
| `hdplay` | Link video HD |
| `wmplay` | Link video có watermark |
| `music` | Link audio MP3 |
| `images` | Mảng URL ảnh cho bài carousel |
| `cover` | Ảnh bìa dự phòng |
| `size` | Kích thước file video thường |
| `hd_size` / `hdsize` | Kích thước file HD |
| `wm_size` / `wmsize` | Kích thước file có watermark |

Lưu ý: Tên trường có thể thay đổi theo phiên bản API, vì vậy nên kiểm tra sự tồn tại của từng field trước khi dùng.

## Ví Dụ Gọi API

### cURL

```bash
curl -X POST "https://tikwm.com/api/" ^
  -H "Content-Type: application/x-www-form-urlencoded" ^
  --data "url=https://www.tiktok.com/@user/video/1234567890&hd=1"
```

### JavaScript

```js
async function fetchTikwm(tiktokUrl) {
  const body = new URLSearchParams({ url: tiktokUrl, hd: '1' });
  const response = await fetch('https://tikwm.com/api/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const json = await response.json();
  if (json.code !== 0) {
    throw new Error(json.msg || 'API error');
  }

  return json.data;
}
```

## Lỗi Thường Gặp

| Trường hợp | Cách xử lý |
| :-- | :-- |
| HTTP status khác 200 | Kiểm tra mạng, URL endpoint, hoặc giới hạn phía server |
| `code !== 0` | Đọc `msg` để biết nguyên nhân do TikWM trả về |
| Thiếu `data` hoặc field rỗng | Kiểm tra lại URL TikTok đầu vào hoặc fallback sang field khác |

## Ghi Chú Sử Dụng

- Nên gửi URL TikTok gốc và hợp lệ.
- Nên kiểm tra cả `play`, `hdplay`, `wmplay`, `music`, `images`, `cover` thay vì phụ thuộc một field duy nhất.
- Nếu cần ưu tiên chất lượng, dùng `hd=1`.

## Tóm Tắt

TikWM API nhận một URL TikTok qua `POST /api/`, trả về JSON với các link media có thể tải và một số metadata liên quan.