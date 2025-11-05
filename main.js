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

/**
 * Render a template by ID with given data
 * Pure function: template ID + data → rendered HTML
 */
function renderTemplate(templateId, data) {
  const template = document.getElementById(templateId).innerHTML;
  return Mustache.render(template, data);
}

/**
 * Fetch data with real-time SSE progress updates
 * @param {boolean} includeJobs - Whether to include pipeline jobs
 * @param {boolean} force - Whether to force cache refresh
 * @param {string} templateId - Mustache template ID to render
 */
window.fetchWithProgress = function(includeJobs, force, templateId) {
  const content = document.getElementById('content');
  const cacheInfo = document.getElementById('cache-info');
  
  // Show loading state using template
  content.innerHTML = renderTemplate('tpl-loading', { message: 'Conectando...' });
  
  const url = `/api/pipelines/stream?includeJobs=${includeJobs}&force=${force}`;
  const eventSource = new EventSource(url);
  
  eventSource.addEventListener('progress', (e) => {
    const data = JSON.parse(e.data);
    // Update only the message text (no HTML manipulation)
    const messageEl = content.querySelector('.loading p');
    if (messageEl) {
      messageEl.textContent = data.message || 'Procesando...';
    }
  });
  
  eventSource.addEventListener('complete', (e) => {
    const response = JSON.parse(e.data);
    eventSource.close();
    
    // Update cache info (text only, no HTML)
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
    
    // Render data using template
    content.innerHTML = renderTemplate(templateId, response);
  });
  
  eventSource.addEventListener('error', (e) => {
    eventSource.close();
    content.innerHTML = renderTemplate('tpl-error', { message: 'Error al cargar datos' });
    console.error('SSE Error:', e);
  });
};
