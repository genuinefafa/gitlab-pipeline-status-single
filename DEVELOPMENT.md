# Development Guidelines

## Git Workflow

### Branch Strategy
- `main` - Production-ready code (**protected: no direct commits**)
- `feature/*` - New features and enhancements
- `fix/*` - Bug fixes
- `chore/*` - Maintenance tasks (dependencies, tooling, docs)

### Pull Request Policy

**All changes to `main` MUST go through Pull Requests.**

#### Rules
1. **Never commit directly to `main`** - Always work in a feature/fix/chore branch
2. **Create PR before merging** - Even for small fixes or urgent changes
3. **Wait for review/approval** - PRs provide visibility and tracking
4. **Use descriptive PR titles** - Follow conventional commit format
5. **Document changes in PR body** - Explain what, why, and how to test

#### PR Workflow
```bash
# 1. Create feature branch from main
git checkout main
git pull origin main
git checkout -b feature/my-feature

# 2. Make atomic commits
git add file.ts
git commit -m "feat: add feature X"

# 3. Push branch
git push -u origin feature/my-feature

# 4. Open PR on GitHub (targeting main)
# 5. Wait for approval and CI checks
# 6. Merge PR (squash or merge commit as appropriate)
# 7. Delete feature branch after merge
```

#### Why PRs are Mandatory
- **Visibility** - Team sees what's changing before it hits main
- **Review** - Catch issues before production
- **Documentation** - PRs serve as changelog for each change
- **CI/CD** - Automated checks run before merge
- **Accountability** - Clear ownership and approval trail

### Commit Standards

**Commits MUST be atomic and incremental.**

Each commit should:
- Represent a single, complete unit of work
- Be reversible without breaking functionality
- Have a clear, descriptive message following conventional commits

#### Commit Message Format
```
<type>: <subject>

[optional body]

[optional footer]
```

**Types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `chore:` - Maintenance (deps, scripts, configs)
- `docs:` - Documentation only
- `style:` - Code style (formatting, no logic change)
- `refactor:` - Code restructuring (no feature/fix)
- `perf:` - Performance improvements
- `test:` - Adding or updating tests

#### Examples
```bash
# Good commits (atomic)
git commit -m "feat: add favicon with GitLab branding"
git commit -m "feat: unify server on port 3000 with static file serving"
git commit -m "fix: correct stage ordering in pipeline display"
git commit -m "chore: remove obsolete Vite scripts from package.json"

# Bad commits (too broad)
git commit -m "feat: implement all improvements"
git commit -m "fix: various fixes"
git commit -m "update files"
```

### Commit Workflow

1. **Make incremental changes** - Work on one logical unit at a time
2. **Test your change** - Ensure it works in isolation
3. **Stage selectively** - Only stage files related to this commit
   ```bash
   git add path/to/specific/file.ts
   ```
4. **Write clear message** - Describe what and why
5. **Commit immediately** - Don't accumulate multiple changes
6. **Repeat** - Move to next atomic change

### Example Session
```bash
# Working on feature/unified-jobs-display

# Change 1: Add favicon
git add public/favicon.svg
git commit -m "feat: add GitLab-themed favicon with pipeline visualization"

# Change 2: Update server configuration
git add src/api-server.ts
git commit -m "feat: unify server on port 3000 and add static file serving"

# Change 3: Create new views
git add public/index.html public/list.html public/chart.html
git commit -m "feat: create separate views with clean URLs

- Add index.html as home page
- Add list.html for table view
- Add chart.html for tree view"

# Continue with more atomic commits...
```

## Code Review Guidelines

When reviewing PRs, check that:
- Commits are atomic and well-separated
- Each commit message is clear and follows conventions
- Changes are incremental and traceable
- No "WIP" or "fix typo" commits in final PR

## Why Atomic Commits Matter

1. **Easier debugging** - `git bisect` can pinpoint exact breaking change
2. **Better code review** - Reviewers understand one change at a time
3. **Clean history** - Project evolution is clear and documented
4. **Safer reverts** - Can undo specific changes without side effects
5. **Better collaboration** - Team members understand what changed and why

## Development Commands

```bash
# Development with hot reload
npm run dev

# Type checking
npm run typecheck

# Build for production
npm run build

# Run production build
npm start
```

## Project Structure

```
public/              # Static files served by Express
  index.html         # Home page
  list.html          # Table view
  chart.html         # Tree view
  favicon.svg        # Application icon

src/
  api-server.ts      # Main Express server (port 3000)
  api-routes-htmx.ts # API endpoints with caching
  gitlab.ts          # GitLab API client
  cache.ts           # Simple in-memory cache
  multi-level-cache.ts # L1/L2/L3 cache system
  templates/         # Mustache templates
    server-*.mustache
    project-*.mustache
    branch-*.mustache
```

## Testing Changes

Before committing:
1. Run `npm run typecheck` to catch type errors
2. Test in browser at `http://localhost:3000`
3. Verify both list and chart views work
4. Check that caching behaves correctly
5. Ensure no console errors

## Cache System

Three-level cache:
- **L1** (30min): Groups and projects
- **L2** (5min): Branches
- **L3** (5s): Pipelines and jobs

When debugging cache issues, use `force=true` query parameter to bypass cache.
