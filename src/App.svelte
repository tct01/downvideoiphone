<script lang="ts">
  type Media = { url: string; label?: string | null; format?: string | null; fileSize?: number | null; sizeStr?: string | null; kind?: 'video' | 'audio'; mimeType?: string | null; quality?: number | null; hasAudio?: boolean | null; proxyToken?: string; proxyExpires?: number };
  type VideoResult = { title?: string | null; imageUrl?: string | null; duration?: string | null; media: Media; medias?: Media[] };

  const platforms = ['Youtube', 'Tiktok', 'Xiaohongshu', 'Instagram', 'Twitter/X', 'Douyin', 'Bilibili', 'Facebook', 'Kwai'];

  let link = '';
  let selectedPlatform = 'Tiktok';
  let status: 'idle' | 'loading' | 'success' | 'error' = 'idle';
  let error = '';
  let result: { title?: string | null; imageUrl?: string | null; duration?: string | null; medias: Media[] } | null = null;
  let savingIndex: number | null = null;
  let previewingIndex: number | null = null;
  let preparedFiles: Array<File | null> = [];
  let mediaStates: Array<'idle' | 'loading' | 'ready' | 'error'> = [];
  let mediaProgress: Array<number | string> = [];
  let mediaAbortControllers: Array<AbortController | null> = [];
  let shareFailures: number[] = [];
  let mediaNeedsRefresh: boolean[] = [];
  let preparationId = 0;
  let linkInput: HTMLInputElement;
  let pasteHint = false;
  let showAllOptions = false;

  const isValidLink = (value: string) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  /** Trích xuất URL đầu tiên từ bất kỳ đoạn văn bản nào */
  function extractUrl(text: string): string {
    const match = text.match(/https?:\/\/[^\s\u4e00-\u9fff\u3000-\u303f\uff00-\uffef，。！？、「」【】《》]+/i);
    if (!match) return text;
    const extracted = match[0].replace(/[.,!?;:)\]}>\"']+$/, '');
    return isValidLink(extracted) ? extracted : text;
  }

  /** Tự detect nền tảng từ hostname */
  function detectPlatform(url: string): string {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host.includes('youtube.com') || host.includes('youtu.be')) return 'Youtube';
      if (host.includes('tiktok.com')) return 'Tiktok';
      if (host.includes('douyin.com')) return 'Douyin';
      if (host.includes('instagram.com')) return 'Instagram';
      if (host.includes('facebook.com') || host.includes('fb.watch')) return 'Facebook';
      if (host.includes('twitter.com') || host.includes('x.com')) return 'Twitter/X';
      if (host.includes('bilibili.com')) return 'Bilibili';
      if (host.includes('kwai.com')) return 'Kwai';
      if (host.includes('xiaohongshu.com') || host.includes('xhs.cn')) return 'Xiaohongshu';
    } catch { /* ignore */ }
    return 'Video';
  }

  async function pasteLink() {
    pasteHint = false;
    error = '';
    try {
      if (!navigator.clipboard?.readText) throw new Error('unavailable');
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) throw new Error('empty');
      link = extractUrl(clipboardText.trim());
      if (!result) status = 'idle';
    } catch {
      linkInput?.focus({ preventScroll: true });
      pasteHint = true;
      if (!result) status = 'idle';
    }
  }

  async function analyse() {
    mediaAbortControllers.forEach((controller) => controller?.abort());
    const runId = ++preparationId;
    error = '';
    result = null;
    previewingIndex = null;
    preparedFiles = [];
    mediaStates = [];
    mediaProgress = [];
    mediaAbortControllers = [];
    shareFailures = [];
    mediaNeedsRefresh = [];

    // Tự động trích xuất URL nếu người dùng dán cả đoạn share text
    const cleanLink = extractUrl(link.trim());
    if (cleanLink !== link.trim()) link = cleanLink;

    if (!isValidLink(link.trim())) {
      status = 'error';
      error = 'Hãy nhập một liên kết đầy đủ, bắt đầu bằng https://.';
      return;
    }

    status = 'loading';
    selectedPlatform = detectPlatform(link.trim());

    try {
      const reqUrl = new URL('/api/video', window.location.origin);
      reqUrl.searchParams.set('link', link.trim());
      const response = await fetch(reqUrl.toString(), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(40_000)
      });

      const payload = (await response.json()) as VideoResult & { error?: string };

      if (!response.ok || !payload.media) {
        throw new Error(payload.error || 'Không tìm thấy video có thể tải từ liên kết này.');
      }

      if (runId !== preparationId) return;
      const seenUrls = new Set<string>();
      const allMedias = [payload.media, ...(payload.medias ?? [])].filter((media) => {
        if (!media?.url || seenUrls.has(media.url)) return false;
        seenUrls.add(media.url);
        return true;
      });
      result = {
        title: payload.title,
        imageUrl: payload.imageUrl,
        duration: payload.duration,
        medias: allMedias
      };
      mediaStates = Array(allMedias.length).fill('idle');
      mediaProgress = Array(allMedias.length).fill(0);
      preparedFiles = Array(allMedias.length).fill(null);
      mediaAbortControllers = Array(allMedias.length).fill(null);
      shareFailures = Array(allMedias.length).fill(0);
      mediaNeedsRefresh = Array(allMedias.length).fill(false);
      showAllOptions = false;
      status = 'success';
      void prepareOneFile(allMedias[0], 0, runId);
    } catch (cause) {
      if (runId !== preparationId) return;
      status = 'error';
      const msg = cause instanceof Error ? cause.message : '';
      // Không hiển thị tên service bên thứ 3 trong thông báo lỗi
      error = msg && !msg.startsWith('primary:') && !msg.startsWith('fallback:') && msg !== 'no_media'
        ? msg
        : 'Không thể tải video. Vui lòng thử lại.';
    }
  }

  function getMediaMimeType(media: Media, responseType: string): string {
    if (media.mimeType) return media.mimeType;
    const format = (media.format || '').toLowerCase();
    if (media.kind === 'audio' || ['mp3', 'm4a', 'aac', 'ogg', 'opus'].includes(format)) {
      if (format === 'm4a' || format === 'aac') return 'audio/mp4';
      if (format === 'ogg' || format === 'opus') return 'audio/ogg';
      return 'audio/mpeg';
    }
    if (format === 'webm') return 'video/webm';
    if (format === 'mov') return 'video/quicktime';
    if (responseType.startsWith('video/') || responseType.startsWith('audio/')) return responseType;
    return 'application/octet-stream';
  }

  function getMediaExtension(media: Media, mimeType = ''): string {
    const format = (media.format || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['mp4', 'webm', 'mov', 'mp3', 'm4a', 'aac', 'ogg', 'opus'].includes(format)) return format;
    if (mimeType === 'video/mp4') return 'mp4';
    if (mimeType === 'video/webm') return 'webm';
    if (mimeType === 'audio/mpeg') return 'mp3';
    if (mimeType === 'audio/mp4') return 'm4a';
    return media.kind === 'audio' ? 'audio' : 'video';
  }

  function getMediaProxyUrl(media: Media, inline = false): string {
    const params = new URLSearchParams({
      url: media.url,
      mime: getMediaMimeType(media, 'application/octet-stream'),
    });
    if (media.proxyToken) params.set('token', media.proxyToken);
    if (media.proxyExpires) params.set('expires', String(media.proxyExpires));
    if (inline) params.set('inline', '1');
    return `/api/media?${params.toString()}`;
  }

  async function prepareOneFile(media: Media, index: number, runId: number) {
    if (mediaStates[index] === 'loading') return;
    mediaAbortControllers[index]?.abort();
    const controller = new AbortController();
    let warmupTimer: ReturnType<typeof setInterval> | null = null;
    let displayedPercent = 1;
    const nextControllers = [...mediaAbortControllers];
    nextControllers[index] = controller;
    mediaAbortControllers = nextControllers;

    try {
      const nextStates = [...mediaStates];
      nextStates[index] = 'loading';
      mediaStates = nextStates;

      const nextProgressInit = [...mediaProgress];
      nextProgressInit[index] = displayedPercent;
      mediaProgress = nextProgressInit;

      // Trong lúc fetch đang chờ upstream trả response headers, chưa có byte để tính
      // tiến trình thực. Cho UI tiến đều từ 1% và dừng ở 30%, sau đó nối tiếp bằng
      // số byte thực nhận từ response stream bên dưới.
      warmupTimer = setInterval(() => {
        if (runId !== preparationId || displayedPercent >= 30) {
          if (warmupTimer) clearInterval(warmupTimer);
          warmupTimer = null;
          return;
        }
        displayedPercent += 1;
        const nextProgress = [...mediaProgress];
        nextProgress[index] = displayedPercent;
        mediaProgress = nextProgress;
      }, 180);

      const proxyUrl = getMediaProxyUrl(media);
      const response = await fetch(proxyUrl, { signal: controller.signal });
      if (warmupTimer) clearInterval(warmupTimer);
      warmupTimer = null;
      if (!response.ok) {
        if ([403, 404, 410].includes(response.status)) throw new Error('refresh_media');
        throw new Error('Không thể tải video. Vui lòng thử lại.');
      }
      const responseType = response.headers.get('content-type') || 'application/octet-stream';
      const contentType = getMediaMimeType(media, responseType);
      const responseSize = Number(response.headers.get('content-length'));
      const declaredSize = Number(media.fileSize);
      const totalBytes = Number.isFinite(responseSize) && responseSize > 0
        ? responseSize
        : Number.isFinite(declaredSize) && declaredSize > 0
          ? declaredSize
          : 0;
      let blob: Blob;

      if (response.body) {
        const reader = response.body.getReader();
        const chunks: ArrayBuffer[] = [];
        let receivedBytes = 0;
        let lastByteProgress = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value.slice().buffer as ArrayBuffer);
          receivedBytes += value.byteLength;

          if (totalBytes > 0) {
            const targetPercent = Math.max(1, Math.min(99, Math.floor((receivedBytes / totalBytes) * 100)));
            while (displayedPercent < targetPercent && runId === preparationId) {
              displayedPercent += 1;
              const nextProgress = [...mediaProgress];
              nextProgress[index] = displayedPercent;
              mediaProgress = nextProgress;
              await new Promise<void>((resolve) => setTimeout(resolve, 16));
            }
          } else {
            const byteProgress = `${(receivedBytes / 1_048_576).toFixed(1)} MB`;
            if (byteProgress === lastByteProgress || runId !== preparationId) continue;
            const nextProgress = [...mediaProgress];
            nextProgress[index] = byteProgress;
            mediaProgress = nextProgress;
            lastByteProgress = byteProgress;
          }
        }

        blob = new Blob(chunks, { type: contentType });
      } else {
        blob = await response.blob();
      }
      if (runId !== preparationId) return;

      const nextFiles = [...preparedFiles];
      const normalizedBlob = blob.type === contentType ? blob : new Blob([blob], { type: contentType });
      nextFiles[index] = new File([normalizedBlob], `clipsave-${Date.now()}.${getMediaExtension(media, contentType)}`, { type: contentType });
      preparedFiles = nextFiles;
      if (totalBytes > 0) {
        while (displayedPercent < 100 && runId === preparationId) {
          displayedPercent += 1;
          const nextProgress = [...mediaProgress];
          nextProgress[index] = displayedPercent;
          mediaProgress = nextProgress;
          await new Promise<void>((resolve) => setTimeout(resolve, 16));
        }
      } else {
        const nextProgress = [...mediaProgress];
        nextProgress[index] = 100;
        mediaProgress = nextProgress;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 180));
      if (runId !== preparationId) return;
      const nextStatesUpdated = [...mediaStates];
      nextStatesUpdated[index] = 'ready';
      mediaStates = nextStatesUpdated;
    } catch (cause) {
      if (runId !== preparationId) return;
      const nextStates = [...mediaStates];
      const aborted = cause instanceof DOMException && cause.name === 'AbortError';
      nextStates[index] = aborted ? 'idle' : 'error';
      mediaStates = nextStates;
      if (!aborted) {
        const nextRefreshStates = [...mediaNeedsRefresh];
        nextRefreshStates[index] = cause instanceof Error && cause.message === 'refresh_media';
        mediaNeedsRefresh = nextRefreshStates;
        error = 'Không thể tải video. Vui lòng thử lại.';
        status = 'error';
      }
    } finally {
      if (warmupTimer) clearInterval(warmupTimer);
      if (mediaAbortControllers[index] === controller) {
        const clearedControllers = [...mediaAbortControllers];
        clearedControllers[index] = null;
        mediaAbortControllers = clearedControllers;
      }
    }
  }

  function downloadPreparedFile(file: File) {
    const objectUrl = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = file.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }

  async function triggerDownloadOrShare(file: File, index: number) {
    savingIndex = index;
    error = '';
    if (result) status = 'success';
    try {
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

      if ((shareFailures[index] ?? 0) >= 2 || !isMobile) {
        downloadPreparedFile(file);
        return;
      }

      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        try {
          await navigator.share({ files: [file], title: result?.title || 'Video' });
          const resetFailures = [...shareFailures];
          resetFailures[index] = 0;
          shareFailures = resetFailures;
          return;
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === 'AbortError') {
            return;
          }
          const nextFailures = [...shareFailures];
          nextFailures[index] = (nextFailures[index] ?? 0) + 1;
          shareFailures = nextFailures;
          error = 'Không thể tải video. Vui lòng thử lại.';
          status = 'error';
          return;
        }
      }
      downloadPreparedFile(file);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      error = 'Không thể tải video. Vui lòng thử lại.';
      status = 'error';
    } finally {
      savingIndex = null;
    }
  }

  async function saveMedia(media: Media, index: number) {
    if (mediaStates[index] === 'error') {
      if (mediaNeedsRefresh[index]) {
        await analyse();
        return;
      }
      const nextStates = [...mediaStates];
      nextStates[index] = 'idle';
      mediaStates = nextStates;
      await prepareOneFile(media, index, preparationId);
      return;
    }

    const file = preparedFiles[index];
    if (file) {
      await triggerDownloadOrShare(file, index);
      return;
    }

    if (mediaStates[index] === 'idle') {
      await prepareOneFile(media, index, preparationId);
    }
  }

  function getQualityBadge(media: Media): { text: string; class: string } {
    const label = (media.label || '').toUpperCase();
    const fmt = (media.format || '').toUpperCase();
    const allText = `${label} ${fmt}`;

    if (
      media.kind === 'audio' ||
      ['MP3', 'AAC', 'M4A', 'OPUS', 'OGG', 'WAV', 'FLAC'].includes(fmt) ||
      allText.includes('AUDIO')
    ) {
      return { text: fmt === 'UNKNOWN' || !fmt ? 'Audio' : fmt, class: 'badge-audio' };
    }

    if ((media.quality ?? 0) >= 2160 || allText.includes('2160') || allText.includes('4K')) {
      return { text: '4K', class: 'badge-4k' };
    }
    if ((media.quality ?? 0) >= 1440 || allText.includes('1440') || allText.includes('2K')) {
      return { text: '2K', class: 'badge-2k' };
    }
    if ((media.quality ?? 0) >= 720 || allText.includes('1080') || allText.includes('720') || allText.includes('HD')) {
      return { text: 'HD', class: 'badge-hd' };
    }
    return { text: 'SD', class: 'badge-sd' };
  }

  function getNumericProgress(index: number): number | null {
    const value = mediaProgress[index];
    return typeof value === 'number' ? Math.max(0, Math.min(100, value)) : null;
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
      {#if status === 'loading'}<span class="mini-loader" aria-hidden="true"></span> Đang kiểm tra…{:else}Tải video <span aria-hidden="true">→</span>{/if}
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
      <p class="platform-note"><span>Hỗ trợ</span> YouTube · TikTok · Instagram · Facebook · Douyin · Bilibili · Kwai,...</p>
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
          <video src={getMediaProxyUrl(bestMedia, true)} poster={result.imageUrl || undefined} controls playsinline preload="metadata"></video>
        </div>
      {/if}
      {#if bestMedia}
        <div class="downloads">
          <div class="download-row">
            <div class="row-actions">
              <button class="view" type="button" on:click={() => (previewingIndex = previewingIndex === 0 ? null : 0)}>{previewingIndex === 0 ? 'Đóng video' : 'Xem video'}</button>
              <button class="save" type="button" on:click={() => saveMedia(bestMedia!, 0)} disabled={mediaStates[0] === 'loading' || savingIndex === 0}>
                {#if mediaStates[0] === 'loading'}
                  <span
                    class:indeterminate={getNumericProgress(0) === null}
                    class="download-progress"
                    style={`--progress-ratio: ${(getNumericProgress(0) ?? 0) / 100}`}
                    aria-hidden="true"
                  ></span>
                  <span class="download-button-content">
                    <span class="mini-loader" aria-hidden="true"></span>
                    {#if getNumericProgress(0) !== null}
                      Đang tải {getNumericProgress(0)}%
                    {:else}
                      {mediaProgress[0] || 'Đang tải…'}
                    {/if}
                  </span>
                {:else if savingIndex === 0}
                  <span class="download-button-content"><span class="mini-loader" aria-hidden="true"></span> Đang mở…</span>
                {:else if mediaStates[0] === 'error'}
                  <span class="download-button-content">{mediaNeedsRefresh[0] ? 'Tải lại' : 'Thử lại'} <span aria-hidden="true">↻</span></span>
                {:else if mediaStates[0] === 'ready'}
                  <span class="download-button-content">Lưu video <span aria-hidden="true">↑</span></span>
                {:else}
                  <span class="download-button-content">Tải & lưu <span aria-hidden="true">↑</span></span>
                {/if}
              </button>
            </div>
          </div>

          {#if result.medias && result.medias.length > 1}
            <div class="options-accordion">
              <button class="accordion-toggle" type="button" on:click={() => (showAllOptions = !showAllOptions)}>
                {showAllOptions ? 'Ẩn tùy chọn khác ▲' : 'Định dạng khác... ▼'}
              </button>
              {#if showAllOptions}
                <div class="accordion-content">
                  {#each result.medias as media, index}
                    {#if index > 0}
                      <div class="option-row">
                        <span class="option-label">
                          <span class={`quality-badge ${getQualityBadge(media).class}`}>{getQualityBadge(media).text}</span>
                          <strong>{media.label || media.format || 'Video'}</strong>
                          {#if media.sizeStr}<span class="size-badge">{media.sizeStr}</span>{/if}
                        </span>
                        <button class="save-option" type="button" on:click={() => saveMedia(media, index)} disabled={mediaStates[index] === 'loading' || savingIndex === index}>
                          {#if mediaStates[index] === 'loading'}
                            <span
                              class:indeterminate={getNumericProgress(index) === null}
                              class="download-progress"
                              style={`--progress-ratio: ${(getNumericProgress(index) ?? 0) / 100}`}
                              aria-hidden="true"
                            ></span>
                            <span class="download-button-content">
                              <span class="mini-loader" aria-hidden="true"></span>
                              {#if getNumericProgress(index) !== null}
                                {getNumericProgress(index)}%
                              {:else}
                                {mediaProgress[index] || 'Đang tải…'}
                              {/if}
                            </span>
                          {:else if savingIndex === index}
                            <span class="download-button-content"><span class="mini-loader" aria-hidden="true"></span> Đang mở…</span>
                          {:else if mediaStates[index] === 'error'}
                            <span class="download-button-content">{mediaNeedsRefresh[index] ? 'Tải lại' : 'Thử lại'} <span aria-hidden="true">↻</span></span>
                          {:else if mediaStates[index] === 'ready'}
                            <span class="download-button-content">Lưu <span aria-hidden="true">↑</span></span>
                          {:else}
                            <span class="download-button-content">Tải <span aria-hidden="true">↑</span></span>
                          {/if}
                        </button>
                      </div>
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
      <aside class="ios-tip"><span aria-hidden="true">↑</span><p><strong>Trên iPhone:</strong> chạm <em>Tải & lưu</em>, sau đó chọn <em>Lưu video</em> để đưa vào Album trên điện thoại.</p></aside>
    </section>
  {/if}

  <footer><span>ClipSave</span><span>•</span><span>TCT ©2026</span></footer>
</main>
