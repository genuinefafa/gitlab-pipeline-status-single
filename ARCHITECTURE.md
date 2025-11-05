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
│  index.html                             │
│  ├── Sakura.css (classless styling)    │
│  ├── htmx (AJAX + client-side templates)│
│  ├── Mustache.js (template rendering)  │
│  ├── hyperscript (declarative events)  │
│  └── Templates (tpl-list, tpl-graph,   │
│                  tpl-loading, tpl-error)│
├─────────────────────────────────────────┤
│  main.js                                │
│  ├── renderTemplate(id, data) → HTML   │
│  ├── updateCacheInfo(text only)        │
│  └── fetchWithProgress(SSE handler)    │
└─────────────────────────────────────────┘
              ↓↑ HTTP/SSE
┌─────────────────────────────────────────┐
│      Vite Dev Server :3000              │
│      (proxies /api to :3001)            │
└─────────────────────────────────────────┘
              ↓↑
┌─────────────────────────────────────────┐
│      Express API Server :3001           │
├─────────────────────────────────────────┤
│  src/api-server.ts                      │
│  ├── GET /api/pipelines (JSON)         │
│  └── GET /api/pipelines/stream (SSE)   │
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

**src/cache.ts**
- File-based caching (10s TTL)
- Stores/retrieves JSON data
- Tracks cache age and fetch duration

**src/types.ts**
- TypeScript interfaces
- Data contracts between backend and frontend

### Frontend (HTML + JavaScript)

**index.html**
- Document structure
- Sakura.css for classless styling
- Script imports (htmx, Mustache, hyperscript)
- **ALL Mustache templates:**
  - `tpl-list` - Table view of pipelines
  - `tpl-graph` - Stage/job visualization
  - `tpl-loading` - Progress state with variable message
  - `tpl-error` - Error state
- Navigation buttons with hyperscript event handlers

**main.js**
- **ZERO HTML strings allowed**
- `renderTemplate(templateId, data)` - renders Mustache templates
- `updateCacheInfo(responseText)` - updates cache metadata (text only)
- `fetchWithProgress(includeJobs, force, templateId)` - SSE handler
- Only manipulates text via `.textContent`

## 🔄 Data Flow

### Standard Request (Cached)
```
User clicks button
  → hyperscript triggers fetchWithProgress()
  → JS renders tpl-loading via Mustache
  → EventSource connects to /api/pipelines/stream
  → Server checks cache → HIT
  → Server sends 'complete' event with JSON
  → JS renders tpl-list or tpl-graph via Mustache
  → JS updates cache info (textContent)
```

### Fresh Fetch (Cache Miss)
```
User clicks Refresh (force=true)
  → JS renders tpl-loading
  → EventSource connects to /api/pipelines/stream?force=true
  → Server checks cache → MISS
  → Server sends 'progress' events:
      - "Connecting to GitLab..."
      - "Fetching groups..."
      - "Processing project 3/15..."
  → JS updates message in tpl-loading (textContent)
  → Server fetches from GitLab
  → Server caches data
  → Server sends 'complete' event with JSON
  → JS renders final view via Mustache
```

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

### GET `/api/pipelines`
**Query params:**
- `includeJobs` (boolean) - fetch pipeline jobs
- `force` (boolean) - bypass cache

**Response (JSON):**
```json
{
  "data": [{ "serverName": "...", "projects": [...] }],
  "cached": true,
  "cacheAge": 23,
  "cacheDuration": 3.45,
  "includeJobs": false,
  "timestamp": 1699123456789
}
```

### GET `/api/pipelines/stream`
**Query params:** same as above

**Response (Server-Sent Events):**
```
event: progress
data: {"message": "Connecting to GitLab...", "stage": "init"}

event: progress
data: {"message": "Processing project 3/15", "current": 3, "total": 15}

event: complete
data: {"data": [...], "cached": false, "cacheDuration": 3.45}
```

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
# Start both servers
npm run dev

# Vite dev server: http://localhost:3000
# API server: http://localhost:3001
```

**Logs show:**
- 📨 Client requests
- 🦊 GitLab API calls
- 💾 Cache hits/misses
- ❌ Errors with stack traces

## 📚 Key Dependencies

- **Vite** - Dev server + build tool
- **Express** - API server
- **TypeScript** - Backend type safety
- **Sakura.css** - Classless CSS framework
- **htmx** - AJAX + client-side templates extension
- **Mustache.js** - Logic-less templates
- **hyperscript** - Declarative event handling

## 🎓 Remember

> **"The server knows data. The client knows presentation. Never shall they mix."**

When in doubt:
1. Is this data? → Backend
2. Is this presentation? → Template in HTML
3. Is this wiring? → Minimal JS with template calls only

---

**Last Updated:** November 4, 2025  
**Enforced by:** All future AI assistants working on this codebase
