/**
 * Kiểu dữ liệu chung cho toàn bộ hệ thống tải media.
 * Tất cả providers phải chuẩn hóa response về các kiểu này.
 */

/** Một media item (video, audio hoặc ảnh) đã chuẩn hóa */
export type Media = {
  url: string;
  label?: string | null;
  format?: string | null;
  fileSize?: number | null;
  sizeStr?: string | null;
  kind?: 'video' | 'audio' | 'image';
  mimeType?: string | null;
  quality?: number | null;
  hasAudio?: boolean | null;
  proxyToken?: string;
  proxyExpires?: number;
};

/** Dữ liệu media đã chuẩn hóa, output chung của mọi provider. */
export type VideoData = {
  title?: string;
  imageUrl?: string;
  duration?: string | null;
  medias: Media[];
};

/** Media đã đi qua lớp chuẩn hóa chung, frontend có thể dùng trực tiếp. */
export type NormalizedMedia = Media & {
  url: string;
  label: string;
  format: string;
  fileSize: number | null;
  sizeStr: string | null;
  kind: 'video' | 'audio' | 'image';
  mimeType: string;
  quality: number;
  hasAudio: boolean | null;
  proxyToken?: string;
  proxyExpires?: number;
};

export type NormalizedVideoData = Omit<VideoData, 'medias'> & {
  medias: NormalizedMedia[];
};
