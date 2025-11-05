/**
 * GitLab Pipeline Monitor - Client-side logic
 * 
 * Architecture:
 * - Backend (Express API): Returns JSON data only
 * - Frontend (htmx + Mustache): Renders HTML via client-side templates
 * - This module: Minimal glue code (cache info display)
 * 
 * Flow:
 * 1. hyperscript triggers htmx requests
 * 2. htmx fetches JSON from API
 * 3. htmx + Mustache render templates with data
 * 4. hyperscript calls updateCacheInfo to update header
 * 
 * Separation of Concerns:
 * - No HTML generation in JS/TS
 * - Templates live in index.html
 * - Backend returns pure JSON
 */

/**
 * Update cache info display in header
 * Called from hyperscript with raw responseText string
 * @param {string} responseText - Raw JSON response from API
 */
window.updateCacheInfo = function (responseText) {
  const response = JSON.parse(responseText);
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
};
