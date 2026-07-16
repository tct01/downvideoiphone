import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const configuredClientKey = process.env.CLIENT_SIGNATURE_KEY?.trim() || env.CLIENT_SIGNATURE_KEY?.trim();
  if (process.env.VERCEL === '1' && !configuredClientKey) {
    throw new Error('CLIENT_SIGNATURE_KEY is not configured');
  }
  const clientSignatureKey = configuredClientKey || 'clipsave-client-development-only';

  return {
    build: {
      target: 'safari12',
    },
    define: {
      __CLIENT_SIGNATURE_KEY__: JSON.stringify(clientSignatureKey),
    },
    server: {
      allowedHosts: ['.ngrok-free.app']
    },
    plugins: [
      svelte(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon-v2.png', 'icons/icon-192-v2.png', 'icons/icon-512-v2.png'],
        manifest: {
          name: 'ClipSave',
          short_name: 'ClipSave',
          description: 'Tải video đa nền tảng và lưu đầy đủ ảnh trong bài TikTok.',
          theme_color: '#f8f7f1',
          background_color: '#f8f7f1',
          display: 'standalone',
          lang: 'vi',
          start_url: '/',
          icons: [
            { src: 'icons/icon-192-v2.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
          ]
        },
        workbox: {
          navigateFallback: 'index.html',
          globPatterns: ['**/*.{js,css,html,svg,ico,png,webp}'],
          runtimeCaching: [{
            urlPattern: /^https:\/\/.*\.(?:png|jpg|jpeg|webp)$/i,
            handler: 'CacheFirst',
            options: { cacheName: 'remote-images', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 } }
          }]
        }
      })
    ]
  };
});
