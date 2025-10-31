# GitLab Pipeline Status Monitor

A terminal-based GitLab pipeline status monitor that displays projects, branches, and their pipeline statuses in a beautiful tree view with auto-refresh capabilities.

## Features

- 🌳 **Tree View**: Hierarchical display of GitLab servers → Projects → Branches → Pipeline Status
- 🔄 **Auto-refresh**: Configurable automatic refresh interval
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

3. Build the project:
```bash
npm run build
```

## Configuration

1. Copy the example configuration file:
```bash
cp config.example.yaml config.yaml
```

2. Edit `config.yaml` with your GitLab server details:

```yaml
# Refresh interval in seconds
refreshInterval: 30

# GitLab servers configuration
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

  - name: "Self-Hosted GitLab"
    url: "https://gitlab.example.com"
    token: "your-self-hosted-token"
    projects:
      - path: "team/backend-api"
      - path: "team/frontend-app"

# Display options (optional)
display:
  recentOnly: false          # Show only recent branches
  pipelinesPerBranch: 1      # Number of pipelines per branch
  compact: false             # Compact display mode
```

### Getting a GitLab Token

1. Go to your GitLab instance
2. Navigate to: **User Settings** → **Access Tokens**
3. Create a new token with at least `read_api` scope
4. Copy the token to your `config.yaml`

## Usage

### Run the monitor:

```bash
npm start
```

Or with a custom config file:

```bash
npm start path/to/custom-config.yaml
```

### Development mode:

```bash
npm run dev
```

### Keyboard Controls

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
│   ├── ✓ main [success]
│   ├── ⏳ feature/new-feature [running]
│   └── ✗ hotfix/bug-123 [failed]
└── 📦 another-project (group/another-project)
    ├── ✓ main [success]
    └── ⊝ develop [no pipeline]

📡 Self-Hosted GitLab
└── 📦 backend-api (team/backend-api)
    ├── ✓ production [success]
    ├── ✓ staging [success]
    └── ⏸ develop [pending]

Last update: 10:30:45 AM | Next update in: 25s | Press 'r' to refresh, 'q' to quit
```

## Project Structure

```
.
├── src/
│   ├── index.ts      # Main entry point
│   ├── config.ts     # Configuration loader
│   ├── gitlab.ts     # GitLab API client
│   ├── ui.ts         # Terminal UI with blessed
│   └── types.ts      # TypeScript type definitions
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
- `projects` - Array of projects to monitor

### Project Configuration

Each project can be specified by:
- `id` - Project ID (numeric)
- `path` - Project path (e.g., "group/project-name")
- `name` - Custom display name (optional)

### Display Options

- `refreshInterval` - Seconds between auto-refresh (default: 30)
- `display.recentOnly` - Only show branches with recent activity
- `display.pipelinesPerBranch` - Number of pipelines to show per branch
- `display.compact` - Use compact display mode

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
