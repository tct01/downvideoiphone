const CLIENT_LANGUAGE = 'vi';

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function createClientSignatureHeaders(link: string): Promise<Record<string, string>> {
  const timestamp = Date.now().toString();
  const normalizedLink = link.trim();
  const payload = `${CLIENT_LANGUAGE}${timestamp}${__CLIENT_SIGNATURE_KEY__}link=${normalizedLink}`;
  const bytes = new TextEncoder().encode(payload);
  const signature = toHex(await crypto.subtle.digest('SHA-256', bytes));

  return {
    'x-clipsave-lang': CLIENT_LANGUAGE,
    'x-clipsave-timestamp': timestamp,
    'x-clipsave-sign': signature,
  };
}
