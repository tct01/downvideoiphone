let proxyInitialized = false;

export async function initProxy() {
  if (proxyInitialized) return;
  proxyInitialized = true;

  const proxyUrl = process.env.PROXY_URL;
  if (!proxyUrl) {
    return;
  }

  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    const proxyAgent = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(proxyAgent);
    console.log('Global proxy initialized with URL:', proxyUrl.replace(/:[^:@\n]+@/g, ':***@')); // Hide password in logs
  } catch (err) {
    console.error('Failed to initialize global proxy:', err);
  }
}
