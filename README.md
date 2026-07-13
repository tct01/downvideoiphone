# ClipSave

PWA tối ưu cho iPhone: phân tích liên kết video công khai, xem trước và lưu video qua Share Sheet của iOS.

## Công nghệ

- Svelte 5 + TypeScript + Vite
- `vite-plugin-pwa` và Workbox
- Vercel Function streaming cho proxy binary video
- Provider adapters chuẩn hóa cho Seekin, GenDownload và Snap Video

## Chạy local

Yêu cầu Node.js 20 trở lên.

```bash
npm ci
npm run build
npm start
```

Mở `http://127.0.0.1:5173`. Lệnh `npm start` phục vụ cả PWA production và endpoint `/api/media`.

Chỉ kiểm tra giao diện với hot reload:

```bash
npm run dev
```

## Biến môi trường

Sao chép `.env.example` thành `.env.local` và đặt một secret dài, ngẫu nhiên:

```env
MEDIA_PROXY_SECRET=replace-with-a-long-random-secret
CLIENT_SIGNATURE_KEY=replace-with-a-separate-client-signature-key
```

`MEDIA_PROXY_SECRET` chỉ chạy phía server, dùng để ký URL proxy trong thời gian ngắn. `CLIENT_SIGNATURE_KEY` được nhúng vào frontend để hạn chế người dùng thông thường gọi trực tiếp `/api/video`; nó không thay thế cơ chế bảo mật phía server. Không đặt hai biến này trong biến có tiền tố `VITE_`.

## Đưa lên GitHub

```bash
git init
git add .
git commit -m "Initial ClipSave PWA"
git branch -M main
git remote add origin <GITHUB_REPOSITORY_URL>
git push -u origin main
```

`node_modules`, `dist`, `.env.local` và thư mục `.vercel` đã được loại khỏi Git qua `.gitignore`.

## Deploy Vercel

1. Import repository GitHub vào Vercel.
2. Framework Preset: **Vite**.
3. Build Command: `npm run build`.
4. Output Directory: `dist`.
5. Thêm `MEDIA_PROXY_SECRET` và `CLIENT_SIGNATURE_KEY` (hai giá trị khác nhau) trong Project Settings → Environment Variables cho Production, Preview và Development.
6. Deploy.

`api/video.ts` thử từng provider một lần theo thứ tự và chuẩn hóa response về contract chung. `api/media.ts` xác minh chữ ký rồi stream video thay vì buffer toàn bộ response.

## Lưu ý vận hành

- Proxy chỉ nhận URL đã được `/api/video` ký, chữ ký hết hạn sau một giờ và mọi redirect vẫn được kiểm tra lại.
- Video không được cache trên server.
- Vercel phù hợp để thử nghiệm. Nếu lưu lượng tải video lớn, nên chuyển proxy sang dịch vụ media chuyên dụng hoặc object storage/CDN để giảm chi phí và tránh giới hạn thời gian Function.
- Chỉ sử dụng với nội dung bạn sở hữu hoặc có quyền lưu.
