import { h, render } from 'https://esm.sh/preact@10.25.4';
import { useState, useEffect, useRef, useCallback } from 'https://esm.sh/preact@10.25.4/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

const html = htm.bind(h);

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
        ${pipeline.created_at && html`<span>Creado ${timeAgo(pipeline.created_at)}</span>`}
        ${pipeline.updated_at && html`<span>Actualizado ${timeAgo(pipeline.updated_at)}</span>`}
      </div>
    </div>
  `;
}

function Branch({ branchData, pipeline }) {
  const status = pipeline ? pipeline.status : 'none';
  const mr = branchData.mergeRequest;

  return html`
    <details class="branch-row">
      <summary>
        <code>${branchData.name}</code>
        <${StatusBadge} status=${status} />
        ${mr && html`
          <a href=${mr.url} target="_blank" rel="noopener" class="mr-link"
             onClick=${(e) => e.stopPropagation()}
             title="MR !${mr.iid} → ${mr.targetBranch}">
            !${mr.iid} ${mr.title}
          </a>
        `}
        <span class="commit-info">
          ${branchData.commitShortId ? html`<span>${branchData.commitShortId}</span>` : ''}
          ${branchData.commitTitle && !mr ? html` ${branchData.commitTitle}` : ''}
        </span>
      </summary>
      ${pipeline && html`<${PipelineDetails} pipeline=${pipeline} />`}
      ${!pipeline && html`<div class="loading-text">Sin pipeline para esta branch</div>`}
    </details>
  `;
}

function Project({ project, clientId, pipelines, onPipelinesUpdate }) {
  const [branches, setBranches] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = useCallback(async (e) => {
    const open = e.target.open;
    setIsOpen(open);

    if (open && !branches) {
      setLoading(true);
      try {
        // Obtener branches
        const data = await fetchJSON(`/api/projects/${project.path}/branches`);
        const branchList = data.branches || [];
        setBranches(branchList);

        if (branchList.length > 0) {
          // Fetch status inicial
          const branchKeys = branchList.map(b => `${project.path}/${b.name}`);
          const statusData = await fetchJSON(`/api/status?branches=${branchKeys.join(',')}&includeJobs=true`);
          if (statusData.pipelines) {
            onPipelinesUpdate(statusData.pipelines);
          }

          // Suscribirse a SSE
          await subscribeBranches(clientId, project.path, branchList.map(b => b.name));
        }
      } catch (err) {
        console.error('Error cargando branches:', err);
      } finally {
        setLoading(false);
      }
    } else if (!open && branches) {
      // Desuscribirse
      try {
        await unsubscribeBranches(clientId, project.path, branches.map(b => b.name));
      } catch (_) { /* ignorar */ }
    }
  }, [branches, clientId, project.path, onPipelinesUpdate]);

  return html`
    <details class="project-card" onToggle=${handleToggle}>
      <summary>
        <a href=${project.url || '#'} target="_blank" rel="noopener"
           onClick=${(e) => e.stopPropagation()}>${project.name || project.path}</a>
      </summary>
      <div class="project-content">
        ${loading && html`<div class="loading-text"><span class="spinner"></span> Cargando branches...</div>`}
        ${branches && branches.map(b => {
          const key = `${project.path}/${b.name}`;
          return html`<${Branch} key=${key} branchData=${b} pipeline=${pipelines[key]} />`;
        })}
        ${branches && branches.length === 0 && html`<div class="loading-text">No se encontraron branches</div>`}
      </div>
    </details>
  `;
}

function ProjectList({ servers, clientId, pipelines, onPipelinesUpdate }) {
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
  const [tokenStatus, setTokenStatus] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const clientIdRef = useRef(crypto.randomUUID());
  const esRef = useRef(null);

  const handlePipelinesUpdate = useCallback((newPipelines) => {
    setPipelines(prev => ({ ...prev, ...newPipelines }));
  }, []);

  const handleSSEEvent = useCallback((type, data) => {
    if (type === 'pipeline-update') {
      // data.branch viene como "grupo/mi-app:main", convertir a "grupo/mi-app/main"
      const key = data.branch ? data.branch.replace(':', '/') : null;
      if (key && data.pipeline) {
        setPipelines(prev => ({ ...prev, [key]: data.pipeline }));
      }
    } else if (type === 'branch-deleted') {
      const key = data.branch ? data.branch.replace(':', '/') : null;
      if (key) {
        setPipelines(prev => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
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

  // Inicializacion
  useEffect(() => {
    const init = async () => {
      await fetchProjects();
      await fetchTokenStatus();
      setLoading(false);
    };
    init();

    // Conectar SSE
    esRef.current = connectSSE(clientIdRef.current, handleSSEEvent, setConnected);

    // Refrescar token status cada 5 minutos
    const tokenInterval = setInterval(fetchTokenStatus, 5 * 60 * 1000);

    return () => {
      if (esRef.current) esRef.current.close();
      clearInterval(tokenInterval);
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
        />`
    }
  `;
}

// --- Montar aplicacion ---
render(html`<${App} />`, document.getElementById('app'));
