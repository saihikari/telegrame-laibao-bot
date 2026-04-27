export const storeQueryCache = new Map<string, { data: any[], timestamp: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of storeQueryCache.entries()) {
    if (now - v.timestamp > 3600000) storeQueryCache.delete(k); // 1 hour
  }
}, 600000);
