# GitLab Pipeline Status Monitor

A GitLab pipeline status monitor with both web interface and terminal UI that displays projects, branches, and their pipeline statuses with auto-refresh capabilities.

## Features

- 🌳 **Tree View**: Hierarchical display of GitLab servers → Projects → Branches → Pipeline Status
- 📁 **Group Support**: Monitor entire GitLab groups (all projects in a group) or individual projects
- 🔄 **Auto-refresh**: Configurable automatic refresh interval
- 📊 **Detailed Information**: For each branch/pipeline see:
  - Color-coded status badges (SUCCESS, FAILED, RUNNING, etc.)
  - Last commit message and commit ID
  - Clickable URLs to projects and pipelines
  - Relative timestamps (e.g., "2 hours ago")
- 🎨 **Color-coded Status**: Visual pipeline status indicators
  - ✓ Success (green)
  - ✗ Failed (red)
  - ⏳ Running (blue)
  - ⏸ Pending (yellow)
  - ⊘ Canceled (magenta)
  - ⊝ Skipped (gray)
  - ⊙ Manual (cyan)
- 🖱️ **Clickable URLs**: Click on project and pipeline URLs in supported terminals
- 🖥️ **Terminal UI**: Keyboard navigation with scrolling support
- 🔌 **Multi-server Support**: Monitor multiple GitLab instances simultaneously
- ⚡ **Fast**: Parallel API requests for optimal performance

## Prerequisites

- Node.js 18+ or higher
- GitLab API token(s) with at least `read_api` scope

## Installation

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

## Usage

### Web Interface (Recommended)

Start the web server:

```bash
npm run web
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

- `q` or `Esc` or `Ctrl+C` - Quit the application
- `r` - Manual refresh
- `↑`/`k` - Scroll up
- `↓`/`j` - Scroll down
- `Page Up` - Scroll up one page
- `Page Down` - Scroll down one page

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

Last update: 10:30:45 AM | Next update in: 25s | URLs are clickable | Press 'r' to refresh, 'q' to quit
```

**Note**: URLs are clickable in terminals that support OSC 8 hyperlinks (iTerm2, VS Code terminal, Windows Terminal, etc.)

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
