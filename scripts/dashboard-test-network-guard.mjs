// Synthetic tests never contact external providers. Only the explicit live-chat
// preview option permits one OpenRouter endpoint; the database stays local.
export function installFetchGuard(allowedOrigins, { liveChat = false } = {}) {
  const originalFetch = globalThis.fetch;
  const allowed = new Set(allowedOrigins);
  const blocked = [];
  globalThis.fetch = async (input, init) => {
    const value = input instanceof Request ? input.url : String(input);
    const url = new URL(value);
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (liveChat === true && url.origin === 'https://openrouter.ai' &&
        url.pathname === '/api/v1/chat/completions' && !url.search && !url.hash &&
        !url.username && !url.password && method === 'POST') {
      return originalFetch(input, { ...init, redirect: 'error' });
    }
    if (!allowed.has(url.origin)) {
      blocked.push(url.origin);
      throw new Error('External network access blocked by synthetic dashboard tests');
    }
    return originalFetch(input, init);
  };
  return { blocked, restore() { globalThis.fetch = originalFetch; } };
}

if (process.env.AKRASIA_TEST_ALLOWED_ORIGINS) {
  installFetchGuard(JSON.parse(process.env.AKRASIA_TEST_ALLOWED_ORIGINS), {
    liveChat: process.env.AKRASIA_PREVIEW_LIVE_CHAT === '1',
  });
}
