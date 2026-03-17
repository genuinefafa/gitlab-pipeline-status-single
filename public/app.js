import { h, render } from 'https://esm.sh/preact@10.25.4';
import { useState, useEffect, useRef, useCallback } from 'https://esm.sh/preact@10.25.4/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

const html = htm.bind(h);

// --- localStorage helpers ---

const STORAGE_KEY = 'glpm-expanded-projects';
const STORAGE_KEY_BRANCHES = 'glpm-expanded-branches';

function getExpandedProjects() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

function saveExpandedProjects(paths) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
}

function getExpandedBranches() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_BRANCHES) || '[]');
  } catch { return []; }
}

function saveExpandedBranches(keys) {
  localStorage.setItem(STORAGE_KEY_BRANCHES, JSON.stringify(keys));
}

function addExpandedBranch(key) {
  const expanded = getExpandedBranches();
  if (!expanded.includes(key)) saveExpandedBranches([...expanded, key]);
}

function removeExpandedBranch(key) {
  saveExpandedBranches(getExpandedBranches().filter(k => k !== key));
}

// --- Utilidades ---

const STATUS_ICONS = {
  success: '\u2713',
  failed: '\u2717',
  running: '\u25B6',
  pending: '\u23F8',
  canceled: '\u2298',
  manual: '\u2699',
  created: '\u25CB',
  skipped: '\u23ED',
  none: '\u2014',
};

function statusLabel(status) {
  const labels = {
    success: 'exitoso',
    failed: 'fallido',
    running: 'corriendo',
    pending: 'pendiente',
    canceled: 'cancelado',
    manual: 'manual',
    created: 'creado',
    skipped: 'saltado',
  };
  return labels[status] || status || 'sin pipeline';
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

// --- SSE ---

function connectSSE(clientId, onEvent, onStatusChange) {
  const es = new EventSource(`/api/events?clientId=${clientId}`);

  es.addEventListener('connected', () => {
    onStatusChange(true);
  });

  es.addEventListener('pipeline-update', (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent('pipeline-update', data);
    } catch (_) { /* ignorar errores de parseo */ }
  });

  es.addEventListener('branch-deleted', (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent('branch-deleted', data);
    } catch (_) { /* ignorar */ }
  });

  es.addEventListener('branches-updated', (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent('branches-updated', data);
    } catch (_) { /* ignorar */ }
  });

  es.onerror = () => {
    onStatusChange(false);
    es.close();
    setTimeout(() => connectSSE(clientId, onEvent, onStatusChange), 5000);
  };

  return es;
}

// --- API helpers ---

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`Error ${res.status}: ${res.statusText}`);
  return res.json();
}

async function subscribeBranches(clientId, projectPath, branchNames) {
  const add = branchNames.map(name => `${projectPath}:${name}`);
  return fetchJSON('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, add }),
  });
}

async function unsubscribeBranches(clientId, projectPath, branchNames) {
  const remove = branchNames.map(name => `${projectPath}:${name}`);
  return fetchJSON('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, remove }),
  });
}

// --- Componentes ---

function StatusBadge({ status }) {
  const s = status || 'none';
  const icon = STATUS_ICONS[s] || STATUS_ICONS.none;
  return html`<mark data-status=${s}>${icon} ${statusLabel(s)}</mark>`;
}

/**
 * Resumen compacto de stages del pipeline de master/main.
 * Cada stage muestra un badge con color según el estado agregado de sus jobs:
 * - todos success → success
 * - alguno failed → failed
 * - alguno running → running
 * - todos manual/skipped y ninguno corrió → manual
 * - mezcla → pending
 */
function MasterStages({ pipeline }) {
  if (!pipeline?.jobs?.length) return null;

  // Agrupar jobs por stage
  const stageMap = new Map();
  for (const job of pipeline.jobs) {
    const stage = job.stage || 'default';
    if (!stageMap.has(stage)) stageMap.set(stage, []);
    stageMap.get(stage).push(job);
  }

  function aggregateStatus(jobs) {
    const statuses = jobs.map(j => j.status);
    if (statuses.every(s => s === 'success')) return 'success';
    if (statuses.some(s => s === 'failed')) return 'failed';
    if (statuses.some(s => s === 'running')) return 'running';
    if (statuses.some(s => s === 'pending' || s === 'created')) return 'pending';
    if (statuses.every(s => s === 'manual' || s === 'skipped')) return 'manual';
    // Mezcla: algunos success + algunos manual
    if (statuses.some(s => s === 'success') && statuses.some(s => s === 'manual' || s === 'skipped')) return 'partial';
    return 'none';
  }

  return html`
    <span class="master-stages">
      ${[...stageMap.entries()].map(([stage, jobs]) => {
        const agg = aggregateStatus(jobs);
        const icon = agg === 'success' ? '\u2713'
          : agg === 'failed' ? '\u2717'
          : agg === 'running' ? '\u25B6'
          : agg === 'pending' ? '\u23F8'
          : agg === 'manual' ? '\u2699'
          : agg === 'partial' ? '\u25D1'
          : '\u2014';
        const names = jobs.map(j => `${j.name}: ${j.status}`).join('\n');
        return html`<span class="stage-badge" data-status=${agg} title=${names}>${icon} ${stage}</span>`;
      })}
    </span>
  `;
}

function TokenStatus({ tokenStatus }) {
  if (!tokenStatus) return null;

  const servers = tokenStatus.servers || [];
  let worstLevel = 'ok';

  const details = [];
  for (const srv of servers) {
    for (const tok of (srv.tokens || [])) {
      details.push({ server: srv.serverName, name: tok.name, status: tok.status, days: tok.daysRemaining });
      if (tok.status === 'expired' || tok.status === 'invalid') worstLevel = 'error';
      else if (tok.status === 'expiring' && worstLevel !== 'error') worstLevel = 'warning';
    }
  }

  const label = worstLevel === 'ok' ? 'Tokens OK'
    : worstLevel === 'warning' ? 'Tokens: alerta'
    : 'Tokens: error';

  return html`
    <span class="token-badge ${worstLevel}">
      ${label}
      <div class="token-tooltip">
        ${details.map(d => html`
          <div>${d.server} / ${d.name}: ${d.status}${d.days != null ? ` (${d.days} dias)` : ''}</div>
        `)}
        ${details.length === 0 && html`<div>Sin informacion de tokens</div>`}
      </div>
    </span>
  `;
}

function Header({ connected, tokenStatus, onRefresh }) {
  return html`
    <header class="header">
      <h1><img src="/favicon.svg" alt="" class="app-icon" /> GitLab Pipeline Monitor</h1>
      <div class="header-actions">
        <${TokenStatus} tokenStatus=${tokenStatus} />
        <button onClick=${onRefresh}>Actualizar</button>
        <span class="connection-dot ${connected ? 'connected' : 'disconnected'}"
              title=${connected ? 'SSE conectado' : 'SSE desconectado'}></span>
      </div>
    </header>
  `;
}

function PipelineDetails({ pipeline }) {
  if (!pipeline) return html`<div class="loading-text">Sin pipeline</div>`;

  const stages = pipeline.stages || [];
  const jobs = pipeline.jobs || [];

  // Agrupar jobs por stage si hay stages
  const hasStages = stages.length > 0 || jobs.some(j => j.stage);

  let stageMap = new Map();
  if (hasStages) {
    for (const job of jobs) {
      const stageName = job.stage || 'sin stage';
      if (!stageMap.has(stageName)) stageMap.set(stageName, []);
      stageMap.get(stageName).push(job);
    }
  }

  return html`
    <div class="pipeline-details">
      ${jobs.length > 0 && hasStages && html`
        <div class="stages-container">
          ${[...stageMap.entries()].map(([stage, stageJobs]) => html`
            <div class="stage">
              <div class="stage-name">${stage}</div>
              ${stageJobs.map(job => html`
                <div class="job-item">
                  <${StatusBadge} status=${job.status} />
                  ${job.web_url
                    ? html`<a href=${job.web_url} target="_blank" rel="noopener">${job.name}</a>`
                    : html`<span>${job.name}</span>`}
                </div>
              `)}
            </div>
          `)}
        </div>
      `}
      ${jobs.length > 0 && !hasStages && html`
        <div>
          ${jobs.map(job => html`
            <div class="job-item">
              <${StatusBadge} status=${job.status} />
              ${job.web_url
                ? html`<a href=${job.web_url} target="_blank" rel="noopener">${job.name}</a>`
                : html`<span>${job.name}</span>`}
            </div>
          `)}
        </div>
      `}
      <div class="pipeline-meta">
        ${pipeline.web_url && html`<a href=${pipeline.web_url} target="_blank" rel="noopener">Pipeline #${pipeline.id}</a>`}
        ${pipeline.duration > 0 && html`<span>${formatDuration(pipeline.duration)}</span>`}
        ${pipeline.finished_at && html`<span>Terminó ${timeAgo(pipeline.finished_at)}</span>`}
        ${!pipeline.finished_at && pipeline.started_at && html`<span>Inició ${timeAgo(pipeline.started_at)}</span>`}
      </div>
    </div>
  `;
}

function Branch({ branchKey, branchData, pipeline, isDeleted }) {
  const status = pipeline ? pipeline.status : 'none';
  const mr = branchData.mergeRequest;
  const detailsRef = useRef(null);
  const wasExpanded = getExpandedBranches().includes(branchKey);

  useEffect(() => {
    if (wasExpanded && detailsRef.current) detailsRef.current.open = true;
  }, []);

  const handleToggle = useCallback((e) => {
    if (e.target.open) addExpandedBranch(branchKey);
    else removeExpandedBranch(branchKey);
  }, [branchKey]);

  return html`
    <details class="branch-row ${isDeleted ? 'branch-deleted' : ''}" ref=${detailsRef} onToggle=${handleToggle}>
      <summary>
        ${mr && mr.approvedBy?.length > 0
          ? html`<span class="mr-approved">✓</span>${mr.approvedBy.map(name => html`<span class="mr-approver">${name}</span>`)}`
          : mr && mr.approvalsLeft > 0
            ? html`<span class="mr-pending-approval">${mr.approvalsLeft}/${mr.approvalsRequired}</span>`
            : null
        }
        <code>${branchData.name}</code>
        ${isDeleted ? html`<mark data-status="merged">mergeado</mark>` : html`<${StatusBadge} status=${status} />`}
        ${mr && html`
          <a href=${mr.url} target="_blank" rel="noopener" class="mr-link"
             onClick=${(e) => e.stopPropagation()}
             title="MR !${mr.iid} → ${mr.targetBranch}">
            !${mr.iid} ${mr.title}
          </a>
        `}
        <span class="commit-info">
          ${branchData.commitShortId ? html`<span>${branchData.commitShortId}</span>` : ''}
          ${branchData.committedDate ? html` <span>${timeAgo(branchData.committedDate)}</span>` : ''}
          ${branchData.commitTitle && !mr ? html` ${branchData.commitTitle}` : ''}
        </span>
      </summary>
      ${pipeline && html`<${PipelineDetails} pipeline=${pipeline} />`}
      ${!pipeline && html`<div class="loading-text">Sin pipeline para esta branch</div>`}
    </details>
  `;
}

function Project({ project, clientId, pipelines, onPipelinesUpdate, connected, sseBranches, deletedBranches }) {
  const [branches, setBranches] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [autoExpanded, setAutoExpanded] = useState(false);
  const [stale, setStale] = useState(false);
  const detailsRef = useRef(null);

  const loadBranches = useCallback(async (force = false) => {
    if (branches && !force) return;
    setLoading(true);
    try {
      const data = await fetchJSON(`/api/projects/${project.path}/branches`);
      const branchList = data.branches || [];
      setBranches(branchList);
      if (branchList.length > 0) {
        const branchKeys = branchList.map(b => `${project.path}/${b.name}`);
        const forceParam = force ? '&force=true' : '';
        const statusData = await fetchJSON(`/api/status?branches=${branchKeys.join(',')}&includeJobs=true${forceParam}`);
        if (statusData.pipelines) onPipelinesUpdate(statusData.pipelines);
        await subscribeBranches(clientId, project.path, branchList.map(b => b.name));
      }
      setStale(false);
    } catch (err) {
      console.error('Error cargando branches:', err);
    } finally {
      setLoading(false);
    }
  }, [branches, clientId, project.path, onPipelinesUpdate]);

  // Auto-expand si estaba guardado en localStorage
  useEffect(() => {
    const expanded = getExpandedProjects();
    if (expanded.includes(project.path) && !autoExpanded) {
      setAutoExpanded(true);
      setStale(true); // Mostrar atenuado hasta que lleguen datos frescos
      setIsOpen(true);
      if (detailsRef.current) detailsRef.current.open = true;
      loadBranches(true); // force=true para saltear cache en page load
    }
  }, []);

  // Resuscribir al reconectar SSE (después de volver del background)
  useEffect(() => {
    if (connected && isOpen && branches?.length > 0) {
      subscribeBranches(clientId, project.path, branches.map(b => b.name)).catch(() => {});
    }
  }, [connected]);

  // Actualizar branches cuando llegan por SSE (refresh periódico del poller)
  useEffect(() => {
    if (sseBranches && isOpen) {
      setBranches(sseBranches);
      setStale(false);
    }
  }, [sseBranches]);

  const handleToggle = useCallback(async (e) => {
    const open = e.target.open;
    setIsOpen(open);

    const expanded = getExpandedProjects();
    if (open) {
      if (!expanded.includes(project.path)) {
        saveExpandedProjects([...expanded, project.path]);
      }
      await loadBranches();
    } else {
      saveExpandedProjects(expanded.filter(p => p !== project.path));
      if (branches) {
        try {
          await unsubscribeBranches(clientId, project.path, branches.map(b => b.name));
        } catch (_) { /* ignorar */ }
      }
    }
  }, [branches, clientId, project.path, loadBranches]);

  // Pipeline de master/main para mostrar resumen de stages en el header
  const masterKey = `${project.path}/master`;
  const mainKey = `${project.path}/main`;
  const masterPipeline = pipelines[masterKey] || pipelines[mainKey];

  return html`
    <details class="project-card" ref=${detailsRef} onToggle=${handleToggle}>
      <summary>
        <a href=${project.url || '#'} target="_blank" rel="noopener"
           onClick=${(e) => e.stopPropagation()}>${project.name || project.path}</a>
        <${MasterStages} pipeline=${masterPipeline} />
      </summary>
      <div class="project-content ${stale ? 'stale' : ''}">
        ${loading && html`<div class="loading-text"><span class="spinner"></span> Cargando branches...</div>`}
        ${branches && branches.map(b => {
          const key = `${project.path}/${b.name}`;
          const isDeleted = deletedBranches?.has(key);
          return html`<${Branch} key=${key} branchKey=${key} branchData=${b} pipeline=${pipelines[key]} isDeleted=${isDeleted} />`;
        })}
        ${branches && branches.length === 0 && html`<div class="loading-text">No se encontraron branches</div>`}
      </div>
    </details>
  `;
}

function ProjectList({ servers, clientId, pipelines, onPipelinesUpdate, connected, branchesByProject, deletedBranches }) {
  if (!servers || servers.length === 0) {
    return html`<div class="loading-text">No hay proyectos configurados</div>`;
  }

  return html`
    <div>
      ${servers.map(server => html`
        <div key=${server.name}>
          <h2 class="server-heading">${server.name}</h2>
          ${(server.projects || []).map(project => html`
            <${Project}
              key=${project.path}
              project=${project}
              clientId=${clientId}
              pipelines=${pipelines}
              onPipelinesUpdate=${onPipelinesUpdate}
              connected=${connected}
              sseBranches=${branchesByProject[project.path]}
              deletedBranches=${deletedBranches}
            />
          `)}
        </div>
      `)}
    </div>
  `;
}

function App() {
  const [servers, setServers] = useState([]);
  const [pipelines, setPipelines] = useState({});
  const [branchesByProject, setBranchesByProject] = useState({});
  const [deletedBranches, setDeletedBranches] = useState(new Set());
  const [tokenStatus, setTokenStatus] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(null);

  const clientIdRef = useRef(crypto.randomUUID());
  const esRef = useRef(null);

  const handlePipelinesUpdate = useCallback((newPipelines) => {
    setPipelines(prev => ({ ...prev, ...newPipelines }));
  }, []);

  const handleSSEEvent = useCallback((type, data) => {
    if (type === 'pipeline-update') {
      const key = data.branch ? data.branch.replace(':', '/') : null;
      if (key && data.pipeline) {
        setPipelines(prev => ({ ...prev, [key]: data.pipeline }));
      }
    } else if (type === 'branch-deleted') {
      const key = data.branch ? data.branch.replace(':', '/') : null;
      if (key) {
        // Marcar como borrado, no eliminarlo — se muestra atenuado
        setDeletedBranches(prev => new Set([...prev, key]));
      }
    } else if (type === 'branches-updated') {
      // Limpiar branches borrados que ya no están en la lista nueva
      if (data.projectPath && data.branches) {
        const newBranchKeys = new Set(data.branches.map(b => `${data.projectPath}/${b.name}`));
        setDeletedBranches(prev => {
          const next = new Set(prev);
          for (const key of prev) {
            if (key.startsWith(data.projectPath + '/') && !newBranchKeys.has(key)) {
              next.delete(key); // Ya no existe, se va a quitar del render
            }
          }
          return next;
        });
      }
      if (data.projectPath && data.branches) {
        setBranchesByProject(prev => ({ ...prev, [data.projectPath]: data.branches }));
      }
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const data = await fetchJSON('/api/projects');
      setServers(data.servers || []);
      setError(null);
    } catch (err) {
      setError(`Error al cargar proyectos: ${err.message}`);
    }
  }, []);

  const fetchTokenStatus = useCallback(async () => {
    try {
      const data = await fetchJSON('/api/token-status');
      setTokenStatus(data);
    } catch (_) { /* no critico */ }
  }, []);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    await fetchProjects();
    await fetchTokenStatus();
    setLoading(false);
  }, [fetchProjects, fetchTokenStatus]);

  // Conectar SSE y resuscribir proyectos abiertos
  const connectAndSubscribe = useCallback(() => {
    if (esRef.current) { try { esRef.current.close(); } catch(_) {} }
    esRef.current = connectSSE(clientIdRef.current, handleSSEEvent, setConnected);
  }, [handleSSEEvent]);

  // Inicializacion
  useEffect(() => {
    const init = async () => {
      await fetchProjects();
      await fetchTokenStatus();
      fetchJSON('/api/version').then(setVersion).catch(() => {});
      setLoading(false);
    };
    init();
    connectAndSubscribe();

    // Refrescar token status cada 5 minutos
    const tokenInterval = setInterval(fetchTokenStatus, 5 * 60 * 1000);

    // Pausar SSE después de 5min en background, reconectar al volver
    let bgTimer = null;
    const handleVisibility = () => {
      if (document.hidden) {
        // Esperar 5 minutos antes de desconectar
        bgTimer = setTimeout(() => {
          if (esRef.current) { try { esRef.current.close(); } catch(_) {} }
          esRef.current = null;
          setConnected(false);
        }, 5 * 60 * 1000);
      } else {
        // Volvió — cancelar timer si no se disparó aún
        if (bgTimer) { clearTimeout(bgTimer); bgTimer = null; }
        // Si ya se había desconectado, reconectar
        if (!esRef.current) connectAndSubscribe();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (esRef.current) esRef.current.close();
      if (bgTimer) clearTimeout(bgTimer);
      clearInterval(tokenInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return html`
    <${Header}
      connected=${connected}
      tokenStatus=${tokenStatus}
      onRefresh=${handleRefresh}
    />
    ${error && html`<div class="error-msg">${error}</div>`}
    ${loading
      ? html`<div class="loading-text"><span class="spinner"></span> Cargando proyectos...</div>`
      : html`<${ProjectList}
          servers=${servers}
          clientId=${clientIdRef.current}
          pipelines=${pipelines}
          onPipelinesUpdate=${handlePipelinesUpdate}
          connected=${connected}
          branchesByProject=${branchesByProject}
          deletedBranches=${deletedBranches}
        />`
    }
    ${version && html`
      <footer class="app-footer">
        v${version.version} ${version.commit !== 'local' ? html`(${version.commit})` : ''}
        <a href="/about">Acerca de</a>
      </footer>
    `}
  `;
}

// --- Montar aplicacion ---
render(html`<${App} />`, document.getElementById('app'));
