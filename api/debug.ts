export async function GET(request: Request): Promise<Response> {
  const reqUrl = new URL(request.url);
  const link = reqUrl.searchParams.get('link') || 'https://www.youtube.com/shorts/7bblV2QiKac';

  const results: Record<string, any> = {};

  // Test snap-video info
  try {
    const res = await fetch('https://api.snap-video.com/api/get-info', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: 'https://snap-video.com',
        Referer: 'https://snap-video.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({ url: link }),
    });
    results.snapVideoInfo = {
      status: res.status,
      ok: res.ok,
      headers: Object.fromEntries(res.headers.entries()),
      body: await res.text(),
    };
  } catch (err: any) {
    results.snapVideoInfo = { error: err.message || String(err) };
  }

  // Test seekin info
  try {
    const res = await fetch('https://api.seekin.ai/ikool/media/download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        referer: 'https://www.seekin.ai',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({ url: link }),
    });
    results.seekinInfo = {
      status: res.status,
      ok: res.ok,
      headers: Object.fromEntries(res.headers.entries()),
      body: await res.text(),
    };
  } catch (err: any) {
    results.seekinInfo = { error: err.message || String(err) };
  }

  return Response.json(results);
}
