# Architecture & Design Principles

## 📋 Code Standards

### Language & Communication

**MANDATORY - All code must follow these rules:**

1. **Code in English ONLY**
   - ✅ All comments, docstrings, and inline documentation in English
   - ✅ All variable names, function names, class names in English
   - ✅ All commit messages in English
   - ✅ All PR titles and descriptions in English
   - ✅ All error messages and user-facing strings in English (or i18n keys)
   - ❌ NO Spanish (or other languages) in code, comments, or Git messages

2. **Why English?**
   - Global collaboration: English is the lingua franca of open-source and tech
   - Consistency: Mixed languages create confusion and maintenance debt
   - Tooling: Most linters, AI assistants, and documentation tools expect English
   - Future-proofing: Code may outlive the original team

**Examples:**

```typescript
// ❌ BAD
function obtenerDatos() {
  // llamamos a la API de GitLab
  const resultado = await fetch('/api/pipelines');
  return resultado;
}

// ✅ GOOD
function fetchData() {
  // Call GitLab API to retrieve pipeline data
  const result = await fetch('/api/pipelines');
  return result;
}
```

**Git commit messages:**
- ❌ `fix: arreglo el bug del textbox`
- ✅ `fix(ui): guard textbox value before trim to satisfy TS18048`

## 🎯 Core Principles

### Strict Separation of Concerns (SoC)

**CRITICAL RULES - DO NOT VIOLATE:**

1. **Backend returns ONLY JSON data**
   - ❌ NO HTML strings in responses
   - ❌ NO formatting or presentation logic
   - ✅ Pure data structures only
   - ✅ Cache metadata (age, duration, etc.)

2. **Frontend has ZERO HTML in JavaScript/TypeScript**
   - ❌ NO HTML string literals in `.js` or `.ts` files
   - ❌ NO template literals with HTML tags
   - ❌ NO `innerHTML = '<div>...'`
   - ✅ Use Mustache templates in `index.html` only
   - ✅ Only `.textContent` updates allowed in JS

3. **All presentation lives in HTML templates**
   - ✅ Mustache templates in `<script type="text/template">` tags
   - ✅ Templates contain ALL markup and structure
   - ✅ CSS classes and styles defined in `<style>` or external CSS

## 🏗️ Architecture Stack

```
┌─────────────────────────────────────────┐
│         Browser (Client)                │
├─────────────────────────────────────────┤
│  chart.html / about.html                │
│  ├── Sakura.css (classless styling)    │
│  ├── htmx (AJAX + client-side updates) │
│  └── Mustache.js (template rendering)  │
└─────────────────────────────────────────┘
              ↓↑ HTTP
┌─────────────────────────────────────────┐
│   Express Server :3000 (UNIFIED)        │
├─────────────────────────────────────────┤
│  src/api-server.ts                      │
│  ├── Static files from public/         │
│  ├── GET / → chart.html                │
│  ├── GET /about → about.html           │
│  └── /api/* → htmx routes              │
├─────────────────────────────────────────┤
│  src/api-routes-htmx.ts                 │
│  ├── GET /api/servers (with cache)     │
│  ├── GET /api/projects (with cache)    │
│  ├── GET /api/branches (with cache)    │
│  └── GET /api/token-status             │
├─────────────────────────────────────────┤
│  src/gitlab.ts                          │
│  └── GitLabClient (HTTP to GitLab API) │
└─────────────────────────────────────────┘
              ↓↑
┌─────────────────────────────────────────┐
│      GitLab Server                      │
│      (projects, pipelines, jobs)        │
└─────────────────────────────────────────┘
```

## 📁 File Responsibilities

### Backend (TypeScript)

**src/api-server.ts**
- Handles HTTP endpoints
- Returns pure JSON with data + metadata
- Implements SSE for real-time progress
- NO HTML generation

**src/gitlab.ts**
- GitLab API client
- Fetches projects, branches, pipelines, jobs
- Returns typed data structures
- NO presentation logic

**src/multi-level-cache.ts**
- Multi-level file-based caching with granular TTLs
- Level 1: Groups/Projects (30min TTL) - structure changes rarely
- Level 2: Branches per project (5min TTL) - branches change occasionally  
- Level 3: Pipeline status per branch (5sec TTL) - status changes frequently
- Enables partial refresh without full UI block
- Each level cached independently for optimal performance

**src/cache.ts** (legacy, for backward compatibility)
- Single-level file-based caching (10s TTL)
- Stores/retrieves full JSON data tree
- Tracks cache age and fetch duration

**src/types.ts**
- TypeScript interfaces
- Data contracts between backend and frontend

### Frontend (HTML)

**public/chart.html**
- Main view with tree/graph visualization
- Sakura.css for classless styling
- htmx for AJAX requests
- Mustache templates embedded in HTML
- No separate JavaScript file needed (htmx handles all interactions)

**public/about.html**
- Information and documentation page
- Links to project resources
- Same styling as chart view

## 🔄 Data Flow

### Standard Request (Cached)
```
User loads page or clicks refresh
  → htmx sends GET /api/servers or /api/projects
  → Server checks multi-level cache
  → Cache HIT → Returns cached JSON
  → htmx swaps HTML using returned data
  → Page displays with cache age indicator
```

### Fresh Fetch (Cache Miss)
```
User forces refresh or cache expired
  → htmx sends GET /api/servers?force=true
  → Server checks cache → MISS
  → Server fetches from GitLab API:
      - Groups and projects (Level 1)
      - Branches per project (Level 2)
      - Pipelines per branch (Level 3)
  → Server caches data at each level
  → Server returns JSON with metadata
  → htmx swaps HTML with fresh data
```

## 💾 Multi-Level Cache Strategy

### Problem

GitLab API calls are slow (~10s for full fetch):
- Fetching groups/projects structure: ~2-3s (changes rarely)
- Fetching branches per project: ~1-2s each (changes occasionally)
- Fetching pipeline status: ~0.5s each (changes frequently)

A single monolithic cache with 10s TTL means:
- ❌ Stale data most of the time (pipelines change every few seconds)
- ❌ Full UI block during refresh (10s blank screen)
- ❌ Wasted API calls (refetching groups/projects that haven't changed)

### Solution: Granular TTLs + Partial Refresh

**Level 1: Groups & Projects (30min TTL)**
- What: GitLab group/project structure (IDs, names, URLs)
- Why 30min: Organizational structure changes rarely
- Cache key: `serverName`
- File: `.cache/groups-projects.json`

**Level 2: Branches (5min TTL)**
- What: Branch names and commit info per project
- Why 5min: Developers create/merge branches occasionally
- Cache key: `projectPath`
- File: `.cache/branches.json`

**Level 3: Pipelines (5sec TTL)**
- What: Pipeline status, jobs, and metadata per branch
- Why 5sec: CI/CD status changes rapidly (running → success/failed)
- Cache key: `projectPath:branchName`
- File: `.cache/pipelines.json`

### Refresh Strategy

**Partial UI Updates (No Full Block):**
1. User sees current cached data immediately
2. Background fetch checks each level independently:
   - Level 1 expired? → Fetch groups/projects, update project list
   - Level 2 expired? → Fetch branches for affected projects, update branch rows
   - Level 3 expired? → Fetch pipelines for affected branches, update status badges
3. htmx swaps only changed DOM elements (no full page reload)
4. Loading indicators (⏳ icon) shown per affected row, not blocking entire UI

**Example: User opens app after 10 minutes**
- Level 1 cache (30min): **HIT** → Groups/projects loaded instantly
- Level 2 cache (5min): **MISS** → Fetch branches in background, show ⏳ per project
- Level 3 cache (5sec): **MISS** → Fetch pipelines in background, show ⏳ per branch
- UI remains interactive throughout; updates appear incrementally

**Example: User refreshes after 3 seconds**
- Level 1 cache (30min): **HIT** → No fetch needed
- Level 2 cache (5min): **HIT** → No fetch needed
- Level 3 cache (5sec): **MISS** → Fetch only pipelines (~0.5s per project)
- Fast refresh with minimal API load

### API Endpoints for Partial Refresh

```
GET /api/groups-projects?server=:name
→ Returns Level 1 cache or fresh fetch (30min TTL)

GET /api/projects/:projectPath/branches
→ Returns Level 2 cache or fresh fetch (5min TTL)

GET /api/branches/:projectPath/:branchName/pipeline?includeJobs=true
→ Returns Level 3 cache or fresh fetch (5sec TTL)
```

### Frontend Integration

**Templates:**
- `tpl-project-row` - Single project with loading state
- `tpl-branch-row` - Single branch with pipeline status
- `tpl-pipeline-badge` - Just the status badge for swapping
- `tpl-loading-icon` - ⏳ Clock icon (no HTML in JS)

**htmx attributes:**
```html
<!-- Branch row with auto-refresh every 5s -->
<tr hx-get="/api/branches/my-project/main/pipeline" 
    hx-trigger="every 5s"
    hx-target="this"
    hx-swap="outerHTML"
    hx-indicator="#loading-icon-main">
  <!-- ... branch data ... -->
  <span id="loading-icon-main" class="htmx-indicator">⏳</span>
</tr>
```

**Result:**
- Zero JavaScript HTML generation (templates only)
- Partial DOM updates (no full refresh)
- Granular cache reduces API load by ~80%
- UI remains interactive during background fetches

## 🎨 Styling Strategy

- **Sakura.css** provides classless base styling
- **Custom CSS** in `<style>` for:
  - Status badges (`mark[data-status]`)
  - Loading spinner (`.spinner`, `.loading`)
  - Graph layout (`.stages`, `.stage`, `.jobs`)
  - Job badges (`.job-badge`)
- **No inline styles** in templates
- **Semantic HTML** that works with Sakura defaults

## 🔌 API Endpoints

### GET `/api/servers`
**Query params:**
- `force` (boolean) - bypass cache

**Response (JSON):**
Returns list of configured GitLab servers with token health status.

### GET `/api/projects`
**Query params:**
- `force` (boolean) - bypass cache

**Response (JSON):**
Returns all projects from all configured servers with branches and pipeline status.

### GET `/api/token-status`
**No params**

**Response (JSON):**
Returns health status of all configured GitLab tokens (valid/expiring/expired/invalid).

## 🚫 Anti-Patterns to AVOID

### ❌ NEVER DO THIS:

```javascript
// ❌ HTML in JavaScript
content.innerHTML = '<div class="error">Error!</div>';

// ❌ HTML string literals
const html = `<p>${message}</p>`;

// ❌ Template literals with tags
function render(data) {
  return `<section><h2>${data.title}</h2></section>`;
}

// ❌ Backend returning HTML
res.json({ html: '<div>...</div>' });
```

### ✅ ALWAYS DO THIS:

```javascript
// ✅ Use templates
content.innerHTML = renderTemplate('tpl-error', { message });

// ✅ Text updates only
element.textContent = message;

// ✅ Backend returns data
res.json({ data: { title: "...", items: [...] } });
```

## 📝 Template Guidelines

### Mustache Template Structure

```html
<script id="tpl-example" type="text/template">
  {{#data}}
    <section>
      <h2>{{title}}</h2>
      {{#items}}
        <article>
          <p>{{description}}</p>
        </article>
      {{/items}}
    </section>
  {{/data}}
</script>
```

**Rules:**
- Use semantic HTML
- Rely on Sakura.css defaults
- Add custom classes only when needed
- Use `data-*` attributes for CSS hooks
- Keep logic in templates minimal (loops, conditionals only)

## 🧪 Development Workflow

```bash
# Start unified Express server
npm run dev

# Server runs on: http://localhost:3000
# Serves both static files and API endpoints
```

**Logs show:**
- 📨 Client requests
- 🦊 GitLab API calls
- 💾 Cache hits/misses
- ❌ Errors with stack traces

## 📚 Key Dependencies

- **Express** - Unified web server (static + API)
- **TypeScript** - Backend type safety
- **Sakura.css** - Classless CSS framework
- **htmx** - AJAX + client-side updates
- **Mustache.js** - Logic-less templates
- **axios** - HTTP client for GitLab API
- **js-yaml** - Configuration file parsing

## 🎓 Remember

> **"The server knows data. The client knows presentation. Never shall they mix."**

When in doubt:
1. Is this data? → Backend
2. Is this presentation? → Template in HTML
3. Is this wiring? → Minimal JS with template calls only

---

**Last Updated:** November 4, 2025  
**Enforced by:** All future AI assistants working on this codebase
