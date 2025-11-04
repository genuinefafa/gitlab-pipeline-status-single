/**
 * GitLab Pipeline Monitor - Client-side rendering
 * 
 * Architecture:
 * - Backend (Express API): Returns JSON data only
 * - Frontend (htmx + hyperscript): Handles HTTP and events
 * - This module: Pure rendering functions (data → HTML)
 * 
 * Flow:
 * 1. hyperscript triggers htmx requests
 * 2. htmx fetches JSON from API
 * 3. hyperscript calls renderList/renderGraph
 * 4. Functions here transform JSON to HTML
 */

/**
 * Update cache info display in header
 * @param {Object} response - API response with cache metadata
 */
function updateCacheInfo(response) {
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
}

/**
 * Render list view - called by hyperscript after htmx request
 * @param {string} responseText - Raw JSON response from API
 */
window.renderList = function (responseText) {
  const response = JSON.parse(responseText);
  updateCacheInfo(response);
  
  const html = buildListHTML(response.data);
  document.getElementById('content').innerHTML = html;
};

/**
 * Render graph view with pipelines - called by hyperscript after htmx request
 * @param {string} responseText - Raw JSON response from API (with jobs)
 */
window.renderGraph = function (responseText) {
  const response = JSON.parse(responseText);
  updateCacheInfo(response);
  
  const html = buildGraphHTML(response.data);
  document.getElementById('content').innerHTML = html;
};

/**
 * Build list view HTML
 */
function buildListHTML(servers) {
  let html = '';
  
  servers.forEach(server => {
    html += `<section><h2>${server.serverName}</h2><table><thead><tr><th>Proyecto</th><th>Branch</th><th>Pipeline</th><th>Commit</th></tr></thead><tbody>`;
    
    server.projects.forEach(project => {
      if (project.error) {
        html += `<tr><td><a href="${project.url}" target="_blank">${project.name}</a></td><td colspan="3"><em>Error: ${project.error}</em></td></tr>`;
      } else {
        project.branches.forEach(branch => {
          html += `<tr>`;
          html += `<td><a href="${project.url}" target="_blank">${project.name}</a></td>`;
          html += `<td><code>${branch.name}</code></td>`;
          
          if (branch.pipeline) {
            html += `<td><a href="${branch.pipeline.web_url}" target="_blank">${renderStatusBadge(branch.pipeline.status)}</a></td>`;
            html += `<td><small title="${branch.commitTitle}">${branch.commitShortId || ''}</small></td>`;
          } else if (branch.error) {
            html += `<td colspan="2"><em>${branch.error}</em></td>`;
          } else {
            html += `<td>${renderStatusBadge('none')}</td><td></td>`;
          }
          
          html += `</tr>`;
        });
      }
    });
    
    html += `</tbody></table></section>`;
  });
  
  return html;
}

/**
 * Build graph view HTML
 */
function buildGraphHTML(servers) {
  let html = '';
  
  servers.forEach(server => {
    html += `<section><h2>${server.serverName}</h2>`;
    
    server.projects.forEach(project => {
      const hasFailure = project.branches.some(b => b.pipeline?.status === 'failed');
      const hasSuccess = project.branches.some(b => b.pipeline?.status === 'success');
      const hasRunning = project.branches.some(b => b.pipeline?.status === 'running');
      
      let status = 'none';
      if (hasFailure) status = 'failed';
      else if (hasRunning) status = 'running';
      else if (hasSuccess) status = 'success';
      
      html += `<article data-status="${status}">`;
      html += `<h3><a href="${project.url}" target="_blank">${project.name}</a></h3>`;
      
      if (project.error) {
        html += `<p><em>Error: ${project.error}</em></p>`;
      } else {
        project.branches.forEach(branch => {
          if (branch.pipeline && branch.pipeline.jobs) {
            html += `<details><summary><code>${branch.name}</code> - ${renderStatusBadge(branch.pipeline.status)}</summary>`;
            html += renderPipelineSVG(branch.pipeline);
            html += `</details>`;
          } else if (branch.pipeline) {
            html += `<p><code>${branch.name}</code> - ${renderStatusBadge(branch.pipeline.status)}</p>`;
          } else {
            html += `<p><code>${branch.name}</code> - ${renderStatusBadge('none')}</p>`;
          }
        });
      }
      
      html += `</article>`;
    });
    
    html += `</section>`;
  });
  
  return html;
}

/**
 * Render status badge
 */
function renderStatusBadge(status) {
  const statusText = status === 'none' ? 'No Pipeline' : status.toUpperCase();
  return `<mark data-status="${status}" title="${statusText}">${statusText}</mark>`;
}

/**
 * Render pipeline SVG (GitLab-style visualization)
 */
function renderPipelineSVG(pipeline) {
  if (!pipeline.jobs || pipeline.jobs.length === 0) {
    return '<p><em>No jobs</em></p>';
  }
  
  const STAGE_ORDER = ['.pre', 'build', 'test', 'deploy', 'staging', 'production', 'cleanup', '.post'];
  
  // Sort jobs by stage
  const sortedJobs = [...pipeline.jobs].sort((a, b) => {
    const aIndex = STAGE_ORDER.indexOf(a.stage);
    const bIndex = STAGE_ORDER.indexOf(b.stage);
    const aOrder = aIndex === -1 ? 999 : aIndex;
    const bOrder = bIndex === -1 ? 999 : bIndex;
    return aOrder - bOrder;
  });
  
  // Group by stage
  const stages = {};
  sortedJobs.forEach(job => {
    if (!stages[job.stage]) stages[job.stage] = [];
    stages[job.stage].push(job);
  });
  
  const stageNames = Object.keys(stages);
  const stageWidth = 150;
  const stageGap = 20;
  const jobHeight = 30;
  const headerHeight = 30;
  
  const maxJobsInStage = Math.max(...Object.values(stages).map(jobs => jobs.length));
  const svgHeight = headerHeight + (maxJobsInStage * jobHeight) + 20;
  const svgWidth = (stageNames.length * stageWidth) + ((stageNames.length - 1) * stageGap) + 40;
  
  let svg = `<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">`;
  
  stageNames.forEach((stageName, stageIndex) => {
    const x = 20 + (stageIndex * (stageWidth + stageGap));
    
    // Stage header
    svg += `<text x="${x + stageWidth/2}" y="20" text-anchor="middle" font-weight="bold" font-size="12">${stageName}</text>`;
    
    // Jobs
    stages[stageName].forEach((job, jobIndex) => {
      const y = headerHeight + (jobIndex * jobHeight) + 10;
      
      let color = '#6b7280';
      if (job.status === 'success') color = '#16a34a';
      else if (job.status === 'failed') color = '#dc2626';
      else if (job.status === 'running') color = '#2563eb';
      else if (job.status === 'pending') color = '#facc15';
      else if (job.status === 'canceled') color = '#6b7280';
      else if (job.status === 'skipped') color = '#9ca3af';
      
      svg += `<a href="${job.web_url}" target="_blank">`;
      svg += `<rect x="${x}" y="${y}" width="${stageWidth - 10}" height="${jobHeight - 5}" fill="${color}" rx="4">`;
      svg += `<title>${job.stage}: ${job.name} (${job.status})</title>`;
      svg += `</rect>`;
      svg += `<text x="${x + (stageWidth - 10)/2}" y="${y + (jobHeight - 5)/2 + 4}" text-anchor="middle" font-size="11" fill="white">${job.name}</text>`;
      svg += `</a>`;
    });
  });
  
  svg += '</svg>';
  
  return svg;
}
