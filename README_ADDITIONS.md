# Additions to README

## Excluding Projects

Add this section after "Display Options":

You can exclude specific projects from monitoring by adding them to the `excludeProjects` array in your `config.yaml`:

```yaml
excludeProjects:
  - "general"
  - "asoproney"
  - "dockerconfig"
  - "pipelines"
  # You can use full paths too
  - "group/unwanted-project"
```

The exclusion is case-insensitive and matches partial names or paths. This is useful for filtering out utility projects, documentation repos, or any other projects you don't want to monitor.

## Visual Indicators

- **Pipeline Status Icons**: Each pipeline status is displayed with a colored circle emoji:
  - 🟢 Success (green)
  - 🔴 Failed (red)
  - 🔵 Running (blue)
  - 🟡 Pending (yellow)
  - 🟠 Waiting/Preparing (orange)
  - 🟣 Manual (purple)
  - ⚫ Canceled/Created (black)
  - ⚪ Skipped/None (white)

- **Loading Indicator**: A spinning animation appears while fetching pipeline data from GitLab
