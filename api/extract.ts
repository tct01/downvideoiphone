export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Request body không hợp lệ.' }, { status: 400 });
  }

  const url = (body as Record<string, unknown>)?.url;
  if (!url || typeof url !== 'string') {
    return Response.json({ error: 'Thiếu trường url.' }, { status: 400 });
  }

  try {
    const upstream = await fetch('https://gendownload.com/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(25_000)
    });

    const data = await upstream.json();
    return Response.json(data, { status: upstream.status });
  } catch {
    return Response.json({ error: 'Không thể kết nối đến GenDownload.' }, { status: 502 });
  }
}
