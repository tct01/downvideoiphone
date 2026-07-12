<script lang="ts">
  type Media = { url: string; format?: string | null; fileSize?: number | null; sizeStr?: string | null };
  type ApiResponse = {
    code?: string;
    msg?: string;
    data?: { title?: string; imageUrl?: string; duration?: string | null; medias?: Media[]; images?: string[] };
  };

  const endpoint = import.meta.env.VITE_API_ENDPOINT || 'https://n8n.tocongtruong.works/webhook/autodownvideo';
  const platforms = ['Youtube', 'Tiktok', 'Xiaohongshu', 'Instagram', 'Twitter/X', 'Douyin', 'Bilibili', 'Facebook', 'Kwai'];

  let link = '';
  let selectedPlatform = 'Tiktok';
  let status: 'idle' | 'loading' | 'success' | 'error' = 'idle';
  let error = '';
  let result: NonNullable<ApiResponse['data']> | null = null;
  let savingIndex: number | null = null;
  let previewingIndex: number | null = null;
  let preparedFiles: Array<File | null> = [];
  let mediaStates: Array<'loading' | 'ready' | 'error'> = [];
  let mediaProgress: number[] = [];
  let preparationId = 0;
  let linkInput: HTMLInputElement;
  let pasteHint = false;

  const isValidLink = (value: string) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  /** Trích xuất URL đầu tiên từ bất kỳ đoạn văn bản nào (hỗ trợ link chia sẻ Douyin, TikTok, v.v.) */
  function extractUrl(text: string): string {
    const match = text.match(/https?:\/\/[^\s\u4e00-\u9fff\u3000-\u303f\uff00-\uffef，。！？、「」【】《》]+/i);
    return match ? match[0].replace(/[.,!?;:)\]}>"']+$/, '') : text;
  }

  /** Gọi GenDownload API và chuẩn hoá thành định dạng nội bộ */
  async function fetchFromGendownload(videoUrl: string): Promise<NonNullable<ApiResponse['data']>> {
    const res = await fetch('https://gendownload.com/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ url: videoUrl })
    });
    if (!res.ok) throw new Error(`GenDownload trả về mã ${res.status}`);

    const gd = (await res.json()) as {
      title?: string;
      thumbnail?: string;
      duration?: number;
      formats?: Array<{ label?: string; type?: string; ext?: string; filesize?: number; url: string }>;
    };

    if (!gd.formats || gd.formats.length === 0) {
      throw new Error('Không tìm thấy video có thể tải từ liên kết này.');
    }

    const medias: Media[] = gd.formats.map((f) => ({
      url: f.url,
      // Nếu type là audio thì đánh dấu để pickBestMp4 lọc ra
      format: f.type === 'audio' ? (f.ext ?? 'audio') : (f.ext ?? 'mp4'),
      fileSize: f.filesize ?? null,
      sizeStr: f.filesize ? `${(f.filesize / 1_048_576).toFixed(1)} MB` : null
    }));

    return {
      title: gd.title,
      imageUrl: gd.thumbnail,
      duration: gd.duration != null ? String(gd.duration) : null,
      medias
    };
  }

  /**
   * Chọn video MP4 chất lượng tốt nhất từ danh sách medias.
   * Loại bỏ audio-only / mp3, ưu tiên fileSize lớn nhất.
   */
  function pickBestMp4(medias: Media[]): Media | null {
    const videoOnly = medias.filter((m) => {
      const fmt = (m.format ?? '').toLowerCase();
      // Loại bỏ audio-only formats
      if (['mp3', 'aac', 'm4a', 'opus', 'ogg', 'audio'].some((a) => fmt.includes(a))) return false;
      // Giữ lại mp4 hoặc không rõ format (mặc định coi là video)
      return true;
    });
    if (videoOnly.length === 0) return medias[0] ?? null;
    // Sắp xếp theo fileSize giảm dần để lấy chất lượng cao nhất
    videoOnly.sort((a, b) => (b.fileSize ?? 0) - (a.fileSize ?? 0));
    return videoOnly[0];
  }

  async function pasteLink() {
    pasteHint = false;
    error = '';
    try {
      if (!navigator.clipboard?.readText) throw new Error('Clipboard API unavailable');
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) throw new Error('Clipboard is empty');
      // Tự động trích xuất URL nếu văn bản dán chứa link lẫn chữ (Douyin, TikTok share text…)
      link = extractUrl(clipboardText.trim());
      if (!result) status = 'idle';
    } catch {
      linkInput?.focus({ preventScroll: true });
      pasteHint = true;
      if (!result) status = 'idle';
    }
  }

  async function analyse() {
    const runId = ++preparationId;
    error = '';
    result = null;
    previewingIndex = null;
    preparedFiles = [];
    mediaStates = [];
    mediaProgress = [];

    // Tự động trích xuất URL nếu người dùng dán cả đoạn share text
    const cleanLink = extractUrl(link.trim());
    if (cleanLink !== link.trim()) link = cleanLink;

    if (!isValidLink(link.trim())) {
      status = 'error';
      error = 'Hãy nhập một liên kết đầy đủ, bắt đầu bằng https://.';
      return;
    }

    status = 'loading';

    // --- Bước 1: thử nguồn chính (n8n) ---
    let data: NonNullable<ApiResponse['data']> | null = null;
    try {
      const url = new URL(endpoint);
      url.searchParams.set('link', link.trim());
      const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Máy chủ trả về mã ${response.status}`);

      const payload = (await response.json()) as ApiResponse;
      const mediaItems = payload.data?.medias ?? [];
      if (payload.code !== '0000' || !payload.data || mediaItems.length === 0) {
        throw new Error(payload.msg || 'Không tìm thấy video.');
      }
      data = payload.data;
    } catch {
      // --- Bước 2: fallback sang GenDownload ---
      try {
        data = await fetchFromGendownload(link.trim());
      } catch (fallbackCause) {
        if (runId !== preparationId) return;
        status = 'error';
        error = fallbackCause instanceof Error
          ? fallbackCause.message
          : 'Không thể phân tích liên kết. Vui lòng thử lại.';
        return;
      }
    }

    if (runId !== preparationId) return;

    const bestMedia = pickBestMp4(data.medias ?? []);
    if (!bestMedia) {
      status = 'error';
      error = 'Không tìm thấy video có thể tải từ liên kết này.';
      return;
    }

    result = { ...data, medias: [bestMedia] };
    status = 'success';
    prepareMediaFiles([bestMedia], runId);
  }

  async function prepareOneFile(media: Media, index: number, runId: number) {
    try {
      const proxyUrl = `/api/media?url=${encodeURIComponent(media.url)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('Không thể tải tệp video từ máy chủ.');
      const contentType = response.headers.get('content-type') || 'video/mp4';
      const totalBytes = Number(response.headers.get('content-length') || 0);
      let blob: Blob;

      if (response.body && totalBytes > 0) {
        const reader = response.body.getReader();
        let receivedBytes = 0;
        let lastProgress = 0;

        const monitoredStream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const { done, value } = await reader.read();
            if (done) { controller.close(); return; }
            receivedBytes += value.byteLength;
            const progress = Math.min(99, Math.round((receivedBytes / totalBytes) * 100));
            if (progress >= lastProgress + 2 && runId === preparationId) {
              const nextProgress = [...mediaProgress];
              nextProgress[index] = progress;
              mediaProgress = nextProgress;
              lastProgress = progress;
            }
            controller.enqueue(value);
          }
        });
        blob = await new Response(monitoredStream, { headers: { 'Content-Type': contentType } }).blob();
      } else {
        blob = await response.blob();
      }
      if (runId !== preparationId) return;

      const nextFiles = [...preparedFiles];
      const nextStates = [...mediaStates];
      nextFiles[index] = new File([blob], `clipsave-${Date.now()}.mp4`, { type: blob.type || 'video/mp4' });
      nextStates[index] = 'ready';
      preparedFiles = nextFiles;
      mediaStates = nextStates;
      const nextProgress = [...mediaProgress];
      nextProgress[index] = 100;
      mediaProgress = nextProgress;
    } catch {
      if (runId !== preparationId) return;
      const nextStates = [...mediaStates];
      nextStates[index] = 'error';
      mediaStates = nextStates;
    }
  }

  function prepareMediaFiles(mediaItems: Media[], runId: number) {
    preparedFiles = Array(mediaItems.length).fill(null);
    mediaStates = Array(mediaItems.length).fill('loading');
    mediaProgress = Array(mediaItems.length).fill(0);
    mediaItems.forEach((media, index) => prepareOneFile(media, index, runId));
  }

  function downloadPreparedFile(file: File) {
    const objectUrl = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = file.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }

  async function saveMedia(media: Media, index: number) {
    if (mediaStates[index] === 'error') {
      window.open(media.url, '_blank', 'noopener,noreferrer');
      return;
    }

    const file = preparedFiles[index];
    if (!file) return;

    savingIndex = index;
    error = '';
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        // Call share before any await so Safari still sees the user's tap.
        await navigator.share({ files: [file], title: result?.title || 'Video' });
        return;
      }
      downloadPreparedFile(file);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      error = cause instanceof Error
        ? `${cause.message}. Hãy chạm lại nút Tải & lưu.`
        : 'Safari chưa thể mở bảng Chia sẻ. Hãy chạm lại nút Tải & lưu.';
      status = 'error';
    } finally {
      savingIndex = null;
    }
  }

  $: mediaCount = result?.medias?.length ?? 0;
  $: bestMedia = result?.medias?.[0] ?? null;
</script>

<svelte:head>
  <meta name="description" content="Chuẩn bị video từ liên kết công khai để lưu trên iPhone." />
</svelte:head>

<main>
  <header class="masthead">
    <a class="brand" href="/" aria-label="ClipSave, về trang chủ">
      <span class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 17v2h14v-2" /></svg>
      </span>
      <span class="brand-copy"><strong>ClipSave</strong><small>Tải video đa nền tảng</small></span>
    </a>
    <div class="header-meta">
      <span class="support-count">9 nền tảng</span>
      <span class="status-pill"><i></i> Sẵn sàng</span>
    </div>
  </header>

  <section class="composer" aria-label="Phân tích liên kết video">
    <label for="video-link">Liên kết video</label>
    <div class="input-wrap" class:input-error={status === 'error' && !result}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 13.4a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66l-1.62 1.62m2.1 4.06a4 4 0 0 0-5.66 0l-2.83 2.83a4 4 0 1 0 5.66 5.66l1.61-1.61" /></svg>
      <input id="video-link" bind:this={linkInput} bind:value={link} on:input={() => (pasteHint = false)} on:keydown={(event) => event.key === 'Enter' && analyse()} placeholder="Dán link video vào đây…" inputmode="url" autocomplete="url" />
      <button class="paste" type="button" on:click={pasteLink}>Dán</button>
    </div>
    {#if pasteHint}<p class="paste-hint">Chạm giữ trong ô rồi chọn <strong>Dán</strong>.</p>{/if}
    <button class="analyse" type="button" on:click={analyse} disabled={status === 'loading'}>
      {#if status === 'loading'}<span class="mini-loader" aria-hidden="true"></span> Đang phân tích…{:else}Tải video <span aria-hidden="true">→</span>{/if}
    </button>
  </section>

  {#if status === 'idle' && !result}
    <section class="product-story" aria-labelledby="story-title">
      <div class="story-lead">
        <p class="eyebrow">TIỆN ÍCH TẢI VIDEO</p>
        <h2 id="story-title">Tải nhanh. Chất lượng cao.</h2>
        <p>Dán liên kết để tải xuống ngay video và âm thanh với chất lượng cao, nhanh chóng và dễ sử dụng.</p>
      </div>
      <ol class="story-steps">
        <li><span>01</span><div><strong>Dán liên kết</strong><small>Từ nền tảng bạn đang xem</small></div></li>
        <li><span>02</span><div><strong>Xem trước</strong><small>Kiểm tra đúng nội dung</small></div></li>
        <li><span>03</span><div><strong>Lưu vào Album</strong><small>Lưu video vào điện thoại</small></div></li>
      </ol>
      <p class="platform-note"><span>Hỗ trợ</span> YouTube · TikTok · Instagram · Facebook · Douyin · Bilibili · Kwai</p>
    </section>
  {/if}

  {#if status === 'error'}
    <section class="message error" role="alert">
      <span aria-hidden="true">!</span>
      <p>{error}</p>
    </section>
  {/if}

  {#if status === 'loading'}
    <section class="result loading-result" aria-label="Đang tải thông tin video">
      <div class="skeleton cover"></div><div><div class="skeleton line wide"></div><div class="skeleton line"></div></div>
    </section>
  {:else if result}
    <section class="result" aria-labelledby="result-title">
      <div class="result-heading">
        <p class="eyebrow">ĐÃ SẴN SÀNG</p>
        <span>Chất lượng cao nhất</span>
      </div>
      <div class="preview">
        {#if result.imageUrl}<img src={result.imageUrl} alt="Ảnh xem trước video" width="90" height="90" loading="lazy" decoding="async" referrerpolicy="no-referrer" />{:else}<div class="fallback-cover" aria-hidden="true">▶</div>{/if}
        <div class="preview-copy"><h2 id="result-title">{result.title || 'Video đã tìm thấy'}</h2><p>{selectedPlatform} · Video công khai</p></div>
      </div>
      {#if previewingIndex === 0 && bestMedia}
        <div class="video-viewer">
          <div class="viewer-head"><strong>Xem trước video</strong><button type="button" on:click={() => (previewingIndex = null)} aria-label="Đóng trình xem">Đóng</button></div>
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={bestMedia.url} poster={result.imageUrl || undefined} controls playsinline preload="metadata"></video>
        </div>
      {/if}
      {#if bestMedia}
        <div class="downloads">
          <div class="download-row">
            <div class="row-actions">
              <button class="view" type="button" on:click={() => (previewingIndex = previewingIndex === 0 ? null : 0)}>{previewingIndex === 0 ? 'Đóng video' : 'Xem video'}</button>
              <button class="save" type="button" on:click={() => saveMedia(bestMedia!, 0)} disabled={mediaStates[0] === 'loading' || savingIndex === 0}>
                {#if mediaStates[0] === 'loading'}<span class="mini-loader" aria-hidden="true"></span> Chuẩn bị {mediaProgress[0] || 0}%{:else if savingIndex === 0}<span class="mini-loader" aria-hidden="true"></span> Đang mở…{:else if mediaStates[0] === 'error'}Mở video <span aria-hidden="true">↗</span>{:else}Tải & lưu <span aria-hidden="true">↑</span>{/if}
              </button>
            </div>
          </div>
        </div>
      {/if}
      <aside class="ios-tip"><span aria-hidden="true">↑</span><p><strong>Trên iPhone:</strong> chạm <em>Tải & lưu</em>, sau đó chọn <em>Lưu video</em> để đưa vào Album trên điện thoại.</p></aside>
    </section>
  {/if}

  <footer><span>ClipSave</span><span>•</span><span>Tô Công Trường @2026</span></footer>
</main>
