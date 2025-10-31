import * as blessed from 'blessed';
import { TreeData, PipelineStatus } from './types';

export class UI {
  private screen: blessed.Widgets.Screen;
  private box: blessed.Widgets.BoxElement;
  private statusBar: blessed.Widgets.BoxElement;

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

    this.screen.append(this.box);
    this.screen.append(this.statusBar);

    // Key bindings
    this.screen.key(['escape', 'q', 'C-c'], () => {
      return process.exit(0);
    });

    this.screen.key(['r'], () => {
      this.box.setContent('{center}Refreshing...{/center}');
      this.screen.render();
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

  render(data: TreeData[], lastUpdate: Date, nextUpdate: Date) {
    const content = this.buildTree(data);
    this.box.setContent(content);

    const now = new Date();
    const timeUntilNext = Math.round((nextUpdate.getTime() - now.getTime()) / 1000);
    const statusContent =
      ` Last update: ${lastUpdate.toLocaleTimeString()} | ` +
      `Next update in: ${timeUntilNext}s | ` +
      `Press 'r' to refresh, 'q' to quit, arrows/j/k to scroll`;

    this.statusBar.setContent(statusContent);
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

        lines.push(`${projectPrefix} {bold}📦 ${project.name}{/bold} {gray-fg}(${project.path}){/gray-fg}`);

        for (let j = 0; j < project.branches.length; j++) {
          const branch = project.branches[j];
          const isLastBranch = j === project.branches.length - 1;
          const branchIndent = isLastProject ? '    ' : '│   ';
          const branchPrefix = isLastBranch ? '└──' : '├──';

          const pipelineIcon = this.getPipelineIcon(branch.pipeline?.status);
          const pipelineColor = this.getPipelineColor(branch.pipeline?.status);

          if (branch.error) {
            lines.push(
              `${branchIndent}${branchPrefix} {red-fg}⚠️  ${branch.name}{/red-fg}`
            );
          } else if (branch.pipeline) {
            lines.push(
              `${branchIndent}${branchPrefix} {${pipelineColor}}${pipelineIcon} ${branch.name}{/${pipelineColor}} ` +
              `{gray-fg}[${branch.pipeline.status}]{/gray-fg}`
            );
          } else {
            lines.push(
              `${branchIndent}${branchPrefix} {gray-fg}⊝ ${branch.name}{/gray-fg} {gray-fg}[no pipeline]{/gray-fg}`
            );
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
}
