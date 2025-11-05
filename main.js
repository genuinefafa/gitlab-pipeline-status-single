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
 * Fetch data with real-time SSE progress updates
 * @param {boolean} includeJobs - Whether to include pipeline jobs
 * @param {boolean} force - Whether to force cache refresh
 * @param {string} templateId - Mustache template ID to render
 */
window.fetchWithProgress = function(includeJobs, force, templateId) {
  const content = document.getElementById('content');
  const cacheInfo = document.getElementById('cache-info');
  
  // Show loading state
  content.innerHTML = '<div class="loading"><div class="spinner"></div><p>Conectando...</p></div>';
  
  const url = `/api/pipelines/stream?includeJobs=${includeJobs}&force=${force}`;
  const eventSource = new EventSource(url);
  
  eventSource.addEventListener('progress', (e) => {
    const data = JSON.parse(e.data);
    const loadingDiv = content.querySelector('.loading p');
    if (loadingDiv) {
      loadingDiv.textContent = data.message || 'Procesando...';
    }
  });
  
  eventSource.addEventListener('complete', (e) => {
    const response = JSON.parse(e.data);
    eventSource.close();
    
    // Update cache info
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
    
    // Render with Mustache template
    const template = document.getElementById(templateId).innerHTML;
    const rendered = Mustache.render(template, response);
    content.innerHTML = rendered;
  });
  
  eventSource.addEventListener('error', (e) => {
    eventSource.close();
    content.innerHTML = '<div class="loading"><p>❌ Error al cargar datos</p></div>';
    console.error('SSE Error:', e);
  });
};
