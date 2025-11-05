import * as blessed from 'blessed';
import { TreeData, PipelineStatus } from './types';

export class UI {
  private screen: blessed.Widgets.Screen;
  private box: blessed.Widgets.BoxElement;
  private statusBar: blessed.Widgets.BoxElement;
  private filterBox: blessed.Widgets.TextboxElement;
  private projectFilter: string = '';
  private onRefreshCallback?: () => void;

  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'GitLab Pipeline Status Monitor',
    });

    this.box = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: '100%-1',
      content: 'Loading...',
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        style: {
          bg: 'blue',
        },
      },
      keys: true,
      vi: true,
      mouse: true,
    });

    this.statusBar = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: '',
      tags: true,
      style: {
        fg: 'white',
        bg: 'blue',
      },
    });

    // Filter input box (hidden by default)
    this.filterBox = blessed.textbox({
      bottom: 1,
      left: 0,
      width: '100%',
      height: 1,
      inputOnFocus: true,
      style: {
        fg: 'white',
        bg: 'green',
      },
      hidden: true,
    });

    this.screen.append(this.box);
    this.screen.append(this.statusBar);
    this.screen.append(this.filterBox);

    // Key bindings
    this.screen.key(['escape', 'q', 'C-c'], () => {
      return process.exit(0);
    });

    this.screen.key(['r'], () => {
      this.box.setContent('{center}Refreshing...{/center}');
      this.screen.render();
      if (this.onRefreshCallback) {
        this.onRefreshCallback();
      }
    });

    // Filter projects
    this.screen.key(['f', '/'], () => {
      this.showFilterInput();
    });

    // Clear filter
    this.screen.key(['c'], () => {
      if (this.projectFilter) {
        this.projectFilter = '';
        if (this.onRefreshCallback) {
          this.onRefreshCallback();
        }
      }
    });

    // Enable scrolling
    this.screen.key(['up', 'k'], () => {
      this.box.scroll(-1);
      this.screen.render();
    });

    this.screen.key(['down', 'j'], () => {
      this.box.scroll(1);
      this.screen.render();
    });

    this.screen.key(['pageup'], () => {
      this.box.scroll(-this.box.height as number);
      this.screen.render();
    });

    this.screen.key(['pagedown'], () => {
      this.box.scroll(this.box.height as number);
      this.screen.render();
    });
  }

  setRefreshCallback(callback: () => void) {
    this.onRefreshCallback = callback;
  }

  render(data: TreeData[], lastUpdate: Date, nextUpdate: Date) {
    // Apply project filter if active
    const filteredData = this.filterData(data);
    const content = this.buildTree(filteredData);
    this.box.setContent(content);

    const now = new Date();
    const timeUntilNext = Math.round((nextUpdate.getTime() - now.getTime()) / 1000);

    let statusContent = ` Last update: ${lastUpdate.toLocaleTimeString()} | Next update in: ${timeUntilNext}s`;

    if (this.projectFilter) {
      statusContent += ` | {green-fg}Filter: "${this.projectFilter}"{/green-fg}`;
    }

    statusContent += ` | f:filter c:clear r:refresh q:quit`;

    this.statusBar.setContent(statusContent);
    this.screen.render();
  }

  private filterData(data: TreeData[]): TreeData[] {
    if (!this.projectFilter) {
      return data;
    }

    const filterLower = this.projectFilter.toLowerCase();

    return data.map(serverData => ({
      ...serverData,
      projects: serverData.projects.filter(project =>
        project.name.toLowerCase().includes(filterLower) ||
        project.path.toLowerCase().includes(filterLower)
      ),
    })).filter(serverData => serverData.projects.length > 0);
  }

  private showFilterInput() {
    this.filterBox.hidden = false;
    this.filterBox.focus();
    this.filterBox.setValue(this.projectFilter);
    this.filterBox.setContent(`Filter projects (Enter to apply, Esc to cancel): ${this.projectFilter}`);

    this.filterBox.readInput((err, value) => {
      this.filterBox.hidden = true;
      this.box.focus();

      if (!err && typeof value === 'string') {
        this.projectFilter = value.trim();
        if (this.onRefreshCallback) {
          this.onRefreshCallback();
        }
      }

      this.screen.render();
    });

    this.screen.render();
  }

  showError(message: string) {
    this.box.setContent(`{red-fg}{bold}Error:{/bold} ${message}{/red-fg}`);
    this.statusBar.setContent(' Press q to quit');
    this.screen.render();
  }

  showLoading(message: string = 'Loading...') {
    this.box.setContent(`{center}{bold}${message}{/bold}{/center}`);
    this.screen.render();
  }

  private buildTree(data: TreeData[]): string {
    const lines: string[] = [];
    lines.push('{bold}{cyan-fg}GitLab Pipeline Status Monitor{/cyan-fg}{/bold}');
    lines.push('');

    for (const serverData of data) {
      lines.push(`{bold}{yellow-fg}📡 ${serverData.serverName}{/yellow-fg}{/bold}`);

      for (let i = 0; i < serverData.projects.length; i++) {
        const project = serverData.projects[i];
        const isLastProject = i === serverData.projects.length - 1;
        const projectPrefix = isLastProject ? '└──' : '├──';

        if (project.error) {
          lines.push(`${projectPrefix} {red-fg}❌ ${project.name}{/red-fg}`);
          lines.push(`    {red-fg}Error: ${project.error}{/red-fg}`);
          continue;
        }

        // Project line with URL
        lines.push(
          `${projectPrefix} {bold}📦 ${project.name}{/bold} {gray-fg}(${project.path}){/gray-fg}`
        );
        if (project.url) {
          const urlIndent = isLastProject ? '    ' : '│   ';
          lines.push(`${urlIndent}{blue-fg}🔗 ${project.url}{/blue-fg}`);
        }

        for (let j = 0; j < project.branches.length; j++) {
          const branch = project.branches[j];
          const isLastBranch = j === project.branches.length - 1;
          const branchIndent = isLastProject ? '    ' : '│   ';
          const branchPrefix = isLastBranch ? '└──' : '├──';
          const detailIndent = isLastProject ? '    ' : '│   ';
          const detailPrefix = isLastBranch ? '    ' : '│   ';

          const pipelineIcon = this.getPipelineIcon(branch.pipeline?.status);
          const pipelineColor = this.getPipelineColor(branch.pipeline?.status);
          const statusBadge = this.getStatusBadge(branch.pipeline?.status);

          if (branch.error) {
            lines.push(
              `${branchIndent}${branchPrefix} {red-fg}⚠️  ${branch.name}{/red-fg}`
            );
          } else if (branch.pipeline) {
            // Branch line with status
            lines.push(
              `${branchIndent}${branchPrefix} {${pipelineColor}}${pipelineIcon} ${branch.name}{/${pipelineColor}} ${statusBadge}`
            );

            // Commit info
            if (branch.commitTitle) {
              const commitLine = `${detailIndent}${detailPrefix}  {gray-fg}└─ ${branch.commitShortId || ''}: ${branch.commitTitle}{/gray-fg}`;
              lines.push(commitLine.length > 120 ? commitLine.substring(0, 117) + '...{/gray-fg}' : commitLine);
            }

            // Pipeline URL
            if (branch.pipeline.web_url) {
              lines.push(`${detailIndent}${detailPrefix}  {blue-fg}└─ 🔗 ${branch.pipeline.web_url}{/blue-fg}`);
            }

            // Timestamp
            const timestamp = this.formatTimestamp(branch.pipeline.updated_at);
            lines.push(`${detailIndent}${detailPrefix}     {gray-fg}⏰ ${timestamp}{/gray-fg}`);
          } else {
            lines.push(
              `${branchIndent}${branchPrefix} {gray-fg}⊝ ${branch.name}{/gray-fg} {gray-fg}[no pipeline]{/gray-fg}`
            );

            // Still show commit info even without pipeline
            if (branch.commitTitle) {
              const commitLine = `${detailIndent}${detailPrefix}  {gray-fg}└─ ${branch.commitShortId || ''}: ${branch.commitTitle}{/gray-fg}`;
              lines.push(commitLine.length > 120 ? commitLine.substring(0, 117) + '...{/gray-fg}' : commitLine);
            }
          }
        }

        if (project.branches.length === 0) {
          const emptyIndent = isLastProject ? '    ' : '│   ';
          lines.push(`${emptyIndent}{gray-fg}(no branches){/gray-fg}`);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  private getPipelineIcon(status?: PipelineStatus): string {
    switch (status) {
      case 'success':
        return '✓';
      case 'failed':
        return '✗';
      case 'running':
        return '⏳';
      case 'pending':
      case 'created':
      case 'waiting_for_resource':
      case 'preparing':
        return '⏸';
      case 'canceled':
        return '⊘';
      case 'skipped':
        return '⊝';
      case 'manual':
        return '⊙';
      default:
        return '?';
    }
  }

  private getPipelineColor(status?: PipelineStatus): string {
    switch (status) {
      case 'success':
        return 'green-fg';
      case 'failed':
        return 'red-fg';
      case 'running':
        return 'blue-fg';
      case 'pending':
      case 'created':
      case 'waiting_for_resource':
      case 'preparing':
        return 'yellow-fg';
      case 'canceled':
        return 'magenta-fg';
      case 'skipped':
        return 'gray-fg';
      case 'manual':
        return 'cyan-fg';
      default:
        return 'white-fg';
    }
  }

  private getStatusBadge(status?: PipelineStatus): string {
    switch (status) {
      case 'success':
        return '{green-bg}{black-fg} SUCCESS {/black-fg}{/green-bg}';
      case 'failed':
        return '{red-bg}{white-fg} FAILED {/white-fg}{/red-bg}';
      case 'running':
        return '{blue-bg}{white-fg} RUNNING {/white-fg}{/blue-bg}';
      case 'pending':
      case 'created':
      case 'waiting_for_resource':
      case 'preparing':
        return '{yellow-bg}{black-fg} PENDING {/black-fg}{/yellow-bg}';
      case 'canceled':
        return '{magenta-bg}{white-fg} CANCELED {/white-fg}{/magenta-bg}';
      case 'skipped':
        return '{gray-bg}{white-fg} SKIPPED {/white-fg}{/gray-bg}';
      case 'manual':
        return '{cyan-bg}{black-fg} MANUAL {/black-fg}{/cyan-bg}';
      default:
        return '{gray-bg}{white-fg} UNKNOWN {/white-fg}{/gray-bg}';
    }
  }

  private formatTimestamp(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) {
        return 'just now';
      } else if (diffMins < 60) {
        return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
      } else if (diffHours < 24) {
        return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
      } else if (diffDays < 7) {
        return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
      } else {
        return date.toLocaleString();
      }
    } catch {
      return 'unknown';
    }
  }
}
