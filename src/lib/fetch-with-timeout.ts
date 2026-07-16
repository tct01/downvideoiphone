function createTimeoutError(timeoutMs: number): Error {
  const error = new Error(`Request timed out after ${timeoutMs}ms`);
  error.name = 'TimeoutError';
  return error;
}

/**
 * Fetch with a timeout that also works on Safari versions without
 * AbortSignal.timeout(). AbortController is optional: very old Safari will
 * still reject on time, although it cannot cancel the underlying request.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 40_000,
): Promise<Response> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const sourceSignal = init.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: (() => void) | undefined;

  if (controller && sourceSignal) {
    const abort = () => controller.abort();
    if (sourceSignal.aborted) abort();
    else {
      sourceSignal.addEventListener('abort', abort, { once: true });
      removeAbortListener = () => sourceSignal.removeEventListener('abort', abort);
    }
  }

  const request = fetch(input, controller ? { ...init, signal: controller.signal } : init);
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(createTimeoutError(timeoutMs));
      controller?.abort();
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    removeAbortListener?.();
  }
}
