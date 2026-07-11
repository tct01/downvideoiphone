# ClipSave

PWA tối ưu cho iPhone: phân tích liên kết video công khai, xem trước và lưu video qua Share Sheet của iOS.

## Công nghệ

- Svelte 5 + TypeScript + Vite
- `vite-plugin-pwa` và Workbox
- Vercel Function streaming cho proxy binary video
- API phân tích mặc định: `https://n8n.tocongtruong.works/webhook/autodownvideo`

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

Sao chép `.env.example` thành `.env.local` nếu cần thay endpoint:

```env
VITE_API_ENDPOINT=https://n8n.tocongtruong.works/webhook/autodownvideo
```

Đây là URL công khai được đưa vào bundle frontend, không đặt secret trong biến có tiền tố `VITE_`.

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
5. Nếu cần endpoint riêng, thêm `VITE_API_ENDPOINT` trong Project Settings → Environment Variables.
6. Deploy.

`api/media.ts` được Vercel tự nhận diện thành Node.js Function và stream video thay vì buffer toàn bộ response.

## Lưu ý vận hành

- Proxy chỉ cho phép HTTPS từ danh sách CDN của các nền tảng được hỗ trợ và kiểm tra lại mọi redirect để hạn chế SSRF.
- Video không được cache trên server.
- Vercel phù hợp để thử nghiệm. Nếu lưu lượng tải video lớn, nên chuyển proxy sang dịch vụ media chuyên dụng hoặc object storage/CDN để giảm chi phí và tránh giới hạn thời gian Function.
- Chỉ sử dụng với nội dung bạn sở hữu hoặc có quyền lưu.
