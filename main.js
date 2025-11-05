// GitLab Pipeline Monitor - Client-side logic (no HTML generation here)

let cachedData = null;

/**
 * Update cache info display (called from hyperscript with the raw responseText)
 * Accepts either a JSON string or an event-like object for resiliency.
 */
window.updateCacheInfo = function (payload) {
  // Support being called with either responseText (string) or event
  const response = typeof payload === 'string'
    ? JSON.parse(payload)
    : JSON.parse(payload?.detail?.xhr?.responseText || '{}');

  if (!response || typeof response !== 'object') return;

  const cacheInfo = document.getElementById('cache-info');

  if (response.cached && response.cacheAge !== null) {
    let text = `📦 Caché (hace ${response.cacheAge}s)`;
    if (response.cacheDuration) {
      text += ` - último fetch: ${response.cacheDuration.toFixed(1)}s`;
    }
    cacheInfo.textContent = text;
  } else {
    let text = '✨ Datos frescos';
    if (response.cacheDuration) {
      text += ` - fetch demoró: ${response.cacheDuration.toFixed(1)}s`;
    }
    cacheInfo.textContent = text;
  }

  // Keep a copy in case we want to enable client-only view toggles later
  cachedData = response.data || null;
};

// Load initial data via htmx (List view without jobs by default)
document.addEventListener('DOMContentLoaded', () => {
  htmx.trigger('button[hx-get*="includeJobs=false"]', 'click');
});
