# GitLab Pipeline Status Monitor

A GitLab pipeline status monitor with both web interface and terminal UI that displays projects, branches, and their pipeline statuses with auto-refresh capabilities.

## Features

- 🌳 **Tree View**: Hierarchical display of GitLab servers → Projects → Branches → Pipeline Status
- 📁 **Group Support**: Monitor entire GitLab groups (all projects in a group) or individual projects
- 🔍 **Project Filter**: Search/filter projects by name or path - essential when monitoring large groups
- 🔄 **Auto-refresh**: Configurable automatic refresh interval
- 📊 **Detailed Information**: For each branch/pipeline see:
  - Color-coded status badges (SUCCESS, FAILED, RUNNING, etc.)
  - Last commit message and commit ID
  - Direct URLs to projects and pipelines
  - Relative timestamps (e.g., "2 hours ago")
- 🎨 **Color-coded Status**: Visual pipeline status indicators
  - ✓ Success (green)
  - ✗ Failed (red)
  - ⏳ Running (blue)
  - ⏸ Pending (yellow)
  - ⊘ Canceled (magenta)
  - ⊝ Skipped (gray)
  - ⊙ Manual (cyan)
- 🖥️ **Terminal UI**: Keyboard navigation with scrolling support
- 🔌 **Multi-server Support**: Monitor multiple GitLab instances simultaneously
- ⚡ **Fast**: Parallel API requests for optimal performance
- 🔐 **Multi-Token Fallback**: Configure multiple tokens per server; automatic failover + health warnings (expiring / expired / invalid)

## Prerequisites

- Node.js 18+ or higher
- GitLab API token(s) with at least `read_api` scope

## 🚀 Quick Start - Docker (Recommended for Production)

**For Raspberry Pi 5 / Home Server deployment:**

```bash
# 1. Clone and configure
git clone https://github.com/genuinefafa/gitlab-pipeline-status-single.git
cd gitlab-pipeline-status-single
cp config.example.yaml config.yaml
nano config.yaml  # Add your GitLab tokens

# 2. Start with Docker Compose
docker-compose up -d

# 3. Access
# http://gitlab.local (or your Pi IP)
# http://pi-ip:9000 (Portainer)
```

**📖 Complete deployment guide:** See [DEPLOYMENT.md](./DEPLOYMENT.md) for full Pi5 setup including:
- Nginx reverse proxy configuration
- Integration with Homebridge/Pi-hole
- HTTPS setup
- Docker secrets for sensitive credentials
- Monitoring and backups

**🎬 LibreELEC users:** See [LIBREELEC.md](./LIBREELEC.md) for LibreELEC-specific installation guide

**⚡ Standalone Docker (just the monitor, no nginx):**

```bash
# For simple setups without reverse proxy
docker-compose -f docker-compose.standalone.yml up -d

# Access at http://localhost:3000
```

This uses Docker's default network and exposes port 3000 directly. Perfect for:
- Development and testing
- Existing Docker networks
- When you don't need nginx/Portainer/other services

**🔧 Manual Docker Deployment (no docker-compose):**

For systems without docker-compose (like LibreELEC):

```bash
# Run all steps
./docker-manual-deploy.sh

# Or run specific steps
./docker-manual-deploy.sh --build          # Only build image
./docker-manual-deploy.sh --stop --run     # Stop old, start new
./docker-manual-deploy.sh -b -s -r -i      # Build, stop, run, show info
./docker-manual-deploy.sh --help           # See all options
```

The script automatically generates version information from git during build.

## Installation (Development / Local)

1. Clone or download this repository:
```bash
git clone <repository-url>
cd gitlab-pipeline-status-single
```

2. Install dependencies:
```bash
npm install
```

**Note:** The TypeScript code will be automatically compiled when you run `npm start`.

## Configuration

1. Copy the example configuration file:
```bash
cp config.example.yaml config.yaml
```

2. Edit `config.yaml` with your GitLab server details:

### Option 1: Monitor Individual Projects

```yaml
refreshInterval: 30

servers:
  - name: "GitLab Main"
    url: "https://gitlab.com"
    token: "your-gitlab-token-here"
    projects:
      # Using project ID
      - id: 12345
        name: "my-project"
      # Using project path (recommended)
      - path: "group/project-name"
```

### Option 2: Monitor Entire Groups

```yaml
refreshInterval: 30

servers:
  - name: "GitLab Production"
    url: "https://gitlab.com"
    token: "your-gitlab-token-here"
    groups:
      # Monitor all projects in a group
      - path: "my-organization/production-apps"
      # Include subgroups too
      - path: "my-organization/all-projects"
        includeSubgroups: true
      # Or use group ID
      - id: 98765
```

### Option 3: Mix Both Groups and Projects

```yaml
refreshInterval: 30

servers:
  - name: "GitLab Mixed"
    url: "https://gitlab.com"
    token: "your-gitlab-token-here"
    # Monitor specific projects
    projects:
      - path: "team/critical-app"
    # AND entire groups
    groups:
      - path: "team/microservices"
        includeSubgroups: true
```

### Getting a GitLab Token

1. Go to your GitLab instance
2. Navigate to: **User Settings** → **Access Tokens**
3. Create a new token with at least `read_api` scope
4. Copy the token to your `config.yaml`

### Multi-Token Support (Redundancy & Health Monitoring)

You can now configure multiple Personal Access Tokens for a single server. The monitor will:

1. Validate each token at startup (and on demand via the endpoint).
2. Prefer a token with status `valid`.
3. Fall back to a token marked `expiring` if no fully valid token is available.
4. Skip tokens that are `expired` or `invalid` (unless no other choice; then the first is used and will fail loudly).
5. Surface overall health in the UI (badge) and via `/api/token-status`.

Add a `tokens:` array instead of `token:`:

```yaml
servers:
  - name: "GitLab Main"
    url: "https://gitlab.com"
    tokens:
      - value: "glpat-PRIMARY123..."
        name: "Primary Token"
        expiresAt: "2025-12-31"   # Optional; if omitted we ask GitLab
      - value: "glpat-BACKUP456..."
        name: "Backup Token"
        # expiresAt: "2026-06-30"
    groups:
      - path: "my-org/platform"
        includeSubgroups: true
```

Legacy single-token configs (`token:`) still work. If both `token:` and `tokens:` are present, `tokens:` takes precedence.

#### Token Health States

| Status     | Meaning                                  | Action Needed                     |
|------------|-------------------------------------------|-----------------------------------|
| valid      | Active and not near expiry                | None                              |
| expiring   | ≤7 days remaining                         | Rotate soon                       |
| expired    | Past expiry date                          | Replace immediately               |
| invalid    | 401 / revoked / unreachable               | Fix scopes or generate new token  |

#### Endpoint: `/api/token-status`

Returns aggregated token health:

```json
{
  "ok": false,
  "servers": [
    {
      "serverName": "GitLab Main",
      "tokens": [
        {
          "name": "Primary Token",
          "status": "invalid",
          "expiresAt": null,
          "daysRemaining": null,
          "message": "Failed to validate: Failed to fetch token info: 401 Unauthorized"
        },
        {
          "name": "Backup Token",
          "status": "valid",
          "expiresAt": "2025-12-31T00:00:00.000Z",
          "daysRemaining": 54,
          "message": "Token expires in 54 days"
        }
      ]
    }
  ]
}
```

`ok` will be `false` if any token is `expiring`, `expired`, or `invalid`.

#### UI Badge

The chart view navigation now shows a badge:

| Badge State | Condition                                      |
|-------------|------------------------------------------------|
| OK          | All tokens `valid`                             |
| Warning     | At least one `expiring` (none invalid/expired) |
| Error       | Any `invalid` or `expired` token               |

Tooltip lists per-token health details.

#### Debug Script

Run quick validation without starting the server:

```bash
npm run token-status
```

Outputs the same JSON as the endpoint.

## Usage

### Web Interface (Recommended)

Start the web server:

```bash
npm run dev
```

Then open your browser at: **http://localhost:3000**

#### Features:
- 🌐 **Clean web interface** with Water.css (minimalist dark theme)
- 📊 **Statistics dashboard** showing servers, projects, branches, and status counts
- 💾 **Local cache** for faster loading (5-minute TTL)
- 🔄 **Auto-refresh** every 60 seconds
- 🔥 **Force refresh button** to bypass cache
- 👁️ **Two view modes:**
  - **List View**: Detailed view with all branches and commit info
  - **Graph View**: Visual representation grouping projects by status
- 🎨 **Color-coded status badges** for quick visual feedback
- 🔗 **Clickable links** to GitLab projects and pipelines

### Terminal UI (Legacy)

For terminal-based monitoring:

```bash
npm start
```

With a custom config file:

```bash
npm start path/to/custom-config.yaml
```

Or development mode:

```bash
npm run dev
```

#### Keyboard Controls (Terminal UI only):

**Navigation:**
- `↑`/`k` - Scroll up
- `↓`/`j` - Scroll down
- `Page Up` - Scroll up one page
- `Page Down` - Scroll down one page

**Actions:**
- `q` or `Esc` or `Ctrl+C` - Quit the application
- `r` - Manual refresh (re-fetch all data)
- `f` or `/` - Filter projects (search by name or path)
- `c` - Clear active filter

**Filtering:**
When monitoring many projects (especially from groups), you can use the filter to focus on specific projects:
1. Press `f` or `/` to open the filter input
2. Type part of a project name or path (case-insensitive)
3. Press `Enter` to apply the filter
4. Only matching projects will be displayed
5. Press `c` to clear the filter and show all projects again

Example: Filter for "backend" to see only projects with "backend" in their name or path.

## Example Output

```
GitLab Pipeline Status Monitor

📡 GitLab Main
├── 📦 my-awesome-project (group/my-awesome-project)
│   🔗 https://gitlab.com/group/my-awesome-project
│   ├── ✓ main  SUCCESS
│   │   └─ a1b2c3d: Fix authentication bug in login module
│   │   └─ 🔗 https://gitlab.com/group/my-awesome-project/-/pipelines/123456
│   │      ⏰ 2 hours ago
│   ├── ⏳ feature/new-feature  RUNNING
│   │   └─ e4f5g6h: Add new dashboard component
│   │   └─ 🔗 https://gitlab.com/group/my-awesome-project/-/pipelines/123457
│   │      ⏰ 15 minutes ago
│   └── ✗ hotfix/bug-123  FAILED
│       └─ i7j8k9l: Quick fix for production issue
│       └─ 🔗 https://gitlab.com/group/my-awesome-project/-/pipelines/123458
│          ⏰ 5 minutes ago
└── 📦 another-project (group/another-project)
    🔗 https://gitlab.com/group/another-project
    ├── ✓ main  SUCCESS
    │   └─ m1n2o3p: Update dependencies
    │   └─ 🔗 https://gitlab.com/group/another-project/-/pipelines/789012
    │      ⏰ 1 day ago
    └── ⊝ develop [no pipeline]
        └─ q4r5s6t: Work in progress

Last update: 10:30:45 AM | Next update in: 25s | f:filter c:clear r:refresh q:quit
```

**Copy URLs**: Simply select and copy the blue URLs to open them in your browser.

## Project Structure

```
.
├── src/
│   ├── server.ts     # Web server (Express)
│   ├── cache.ts      # Cache management
│   ├── index.ts      # Terminal UI entry point
│   ├── config.ts     # Configuration loader
│   ├── gitlab.ts     # GitLab API client
│   ├── ui.ts         # Terminal UI with blessed
│   └── types.ts      # TypeScript type definitions
├── .cache/           # Cache directory (auto-generated)
├── config.example.yaml
├── package.json
├── tsconfig.json
└── README.md
```

## Configuration Options

### Server Configuration

- `name` - Display name for the server
- `url` - GitLab instance URL (e.g., https://gitlab.com)
- `token` - GitLab API token
- `projects` - Array of individual projects to monitor (optional)
- `groups` - Array of groups to monitor (optional)

**Note:** You must specify at least one of `projects` or `groups`, or both.

### Project Configuration

Each project can be specified by:
- `id` - Project ID (numeric)
- `path` - Project path (e.g., "group/project-name")
- `name` - Custom display name (optional)

### Group Configuration

Each group can be specified by:
- `id` - Group ID (numeric)
- `path` - Group path (e.g., "my-organization/team")
- `name` - Custom display name (optional)
- `includeSubgroups` - Include all subgroups and their projects (optional, default: false)

When you specify a group, the monitor will automatically fetch and display all projects within that group.

### Display Options

- `refreshInterval` - Seconds between auto-refresh (default: 30)
- `display.recentOnly` - Only show branches with recent activity
- `display.pipelinesPerBranch` - Number of pipelines to show per branch
- `display.compact` - Use compact display mode

## Cache System

The web interface uses a local file-based cache to improve performance:

- **Cache location**: `.cache/pipeline-data.json`
- **Cache duration**: 5 minutes (configurable in `src/cache.ts`)
- **Cache strategy**: 
  - First request fetches fresh data from GitLab
  - Subsequent requests use cached data if not expired
  - Use "Force Refresh" button to bypass cache
  - Cache is automatically updated on expiration
- **Auto-generated**: Cache directory is created automatically on first run

## Troubleshooting

### Check version information

To verify which version is running:

```bash
# Via API endpoint
curl http://localhost:3000/api/version

# Or check Docker logs on startup
docker logs gitlab-monitor | head -10
```

The version includes git commit hash and build date for tracking deployments.

### Authentication errors
- Verify your token has the correct permissions (`read_api` scope)
- Check that the token hasn't expired
- Ensure the GitLab URL is correct

### No pipelines showing
- Pipelines may be disabled for the project
- Check that CI/CD is configured for the repository
- Verify the branch has at least one pipeline run

### Connection timeouts
- Check your network connection
- Verify the GitLab server is accessible
- Consider increasing the timeout in `src/gitlab.ts`

## Development

### Build:
```bash
npm run build
```

### Watch mode:
```bash
npm run watch
```

### TypeScript compilation:
The project uses TypeScript with strict mode enabled. Source files are in `src/` and compiled output goes to `dist/`.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## Roadmap

- [ ] Filter branches by pattern
- [ ] Show pipeline duration
- [ ] Export status to JSON/HTML
- [ ] Desktop notifications for status changes
- [ ] Job-level status display
- [ ] Pipeline retry functionality
- [ ] Multiple theme support
