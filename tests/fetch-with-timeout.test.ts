import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchWithTimeout } from '../src/lib/fetch-with-timeout.js';

test('returns the fetch response before the timeout', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('ok');

  try {
    const response = await fetchWithTimeout('https://example.com', {}, 100);
    assert.equal(await response.text(), 'ok');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('times out when AbortController is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const originalAbortController = globalThis.AbortController;
  globalThis.fetch = () => new Promise<Response>(() => {});
  Object.defineProperty(globalThis, 'AbortController', {
    configurable: true,
    value: undefined,
  });

  try {
    await assert.rejects(
      fetchWithTimeout('https://example.com', {}, 5),
      (error: Error) => error.name === 'TimeoutError',
    );
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'AbortController', {
      configurable: true,
      value: originalAbortController,
      writable: true,
    });
  }
});

test('aborts the underlying request when AbortController is available', async () => {
  const originalFetch = globalThis.fetch;
  let receivedSignal: AbortSignal | null = null;
  globalThis.fetch = (_input, init) => {
    receivedSignal = init?.signal ?? null;
    return new Promise<Response>(() => {});
  };

  try {
    await assert.rejects(fetchWithTimeout('https://example.com', {}, 5));
    assert.equal(receivedSignal?.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
