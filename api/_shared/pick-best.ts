import { normalizeMedia } from './normalize.js';
import type { Media, NormalizedMedia } from './types.js';

/**
 * Chọn video MP4 chất lượng tốt nhất từ danh sách media.
 * Loại audio/video-only, ưu tiên độ phân giải rồi mới đến dung lượng.
 */
export function pickBestMp4(medias: Media[]): NormalizedMedia | null {
  const videos = medias
    .map(normalizeMedia)
    .filter((media): media is NormalizedMedia => Boolean(media))
    .filter((media) => media.kind === 'video' && media.hasAudio !== false)
    .sort((a, b) => {
      const qualityDiff = b.quality - a.quality;
      if (qualityDiff !== 0) return qualityDiff;
      return (b.fileSize ?? 0) - (a.fileSize ?? 0);
    });
  const mp4 = videos.filter((media) => media.format === 'mp4' || media.mimeType === 'video/mp4');
  return mp4[0] ?? videos[0] ?? null;
}
