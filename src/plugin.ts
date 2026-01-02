import WebSocket from 'ws';
import { fetchWorkflowStatus } from './github-api';
import { ActionInstance, ActionSettings, WorkflowStatus, WillAppearPayload, KeyDownPayload } from './types';

const LONG_PRESS_THRESHOLD = 500; // ms

// Status colors
const STATUS_COLORS: Record<WorkflowStatus, string> = {
  success: '#22c55e',
  failure: '#ef4444',
  pending: '#f59e0b',
  unknown: '#6b7280'
};

class StreamDeckPlugin {
  private websocket: WebSocket | null = null;
  private actions: Map<string, ActionInstance> = new Map();
  private pluginUUID: string = '';

  private getStatusIcon(status: WorkflowStatus): string {
    const color = STATUS_COLORS[status];
    switch (status) {
      case 'success':
        return `<circle cx="36" cy="36" r="30" fill="${color}"/>
                <path d="M22 36 L32 46 L50 26" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
      case 'failure':
        return `<circle cx="36" cy="36" r="30" fill="${color}"/>
                <path d="M24 24 L48 48 M48 24 L24 48" stroke="white" stroke-width="5" stroke-linecap="round" fill="none"/>`;
      case 'pending':
        return `<circle cx="36" cy="36" r="30" fill="${color}"/>
                <circle cx="36" cy="36" r="20" stroke="white" stroke-width="4" fill="none" stroke-dasharray="31 100"/>`;
      default:
        return `<circle cx="36" cy="36" r="30" fill="${color}"/>
                <text x="36" y="44" text-anchor="middle" font-size="28" font-family="Arial" fill="white" font-weight="bold">?</text>`;
    }
  }

  private generateImage(status: WorkflowStatus, dateStr?: string): string {
    const icon = this.getStatusIcon(status);

    // Format date for display (DD/MM HH:MM)
    let dateDisplay = '';
    if (dateStr) {
      const date = new Date(dateStr);
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      dateDisplay = `${day}/${month} ${hours}:${minutes}`;
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
      <rect width="144" height="144" fill="#1a1a1a"/>
      ${dateStr ? `<text x="140" y="18" text-anchor="end" font-size="14" font-family="Arial, sans-serif" fill="#ffffff">${dateDisplay}</text>` : ''}
      <g transform="translate(36, 36)">
        ${icon}
      </g>
    </svg>`;

    const base64 = Buffer.from(svg).toString('base64');
    return `data:image/svg+xml;base64,${base64}`;
  }

  connect(port: number, uuid: string, registerEvent: string, _info: string): void {
    this.pluginUUID = uuid;
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.websocket = ws;

    ws.on('open', () => {
      this.send({
        event: registerEvent,
        uuid: uuid
      });
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    ws.on('close', () => {
      console.log('WebSocket closed');
    });
  }

  private handleMessage(message: Record<string, unknown>): void {
    const event = message.event as string;
    const context = message.context as string;
    const payload = message.payload as Record<string, unknown>;

    switch (event) {
      case 'willAppear':
        this.handleWillAppear(context, payload as unknown as WillAppearPayload);
        break;
      case 'willDisappear':
        this.handleWillDisappear(context);
        break;
      case 'keyDown':
        this.handleKeyDown(context, payload as unknown as KeyDownPayload);
        break;
      case 'keyUp':
        this.handleKeyUp(context, payload as unknown as KeyDownPayload);
        break;
      case 'didReceiveSettings':
        this.handleDidReceiveSettings(context, payload as { settings: ActionSettings });
        break;
    }
  }

  private handleWillAppear(context: string, payload: WillAppearPayload): void {
    const settings = payload.settings || this.getDefaultSettings();
    const instance: ActionInstance = {
      context,
      settings
    };

    this.actions.set(context, instance);
    this.startRefreshTimer(context);
    this.refreshStatus(context);
  }

  private handleWillDisappear(context: string): void {
    const instance = this.actions.get(context);
    if (instance?.refreshTimer) {
      clearInterval(instance.refreshTimer);
    }
    this.actions.delete(context);
  }

  private handleKeyDown(context: string, _payload: KeyDownPayload): void {
    const instance = this.actions.get(context);
    if (instance) {
      instance.keyDownTime = Date.now();
    }
  }

  private handleKeyUp(context: string, _payload: KeyDownPayload): void {
    const instance = this.actions.get(context);
    if (!instance) return;

    const pressDuration = Date.now() - (instance.keyDownTime || 0);

    if (pressDuration >= LONG_PRESS_THRESHOLD) {
      // Long press: open GitHub
      this.openGitHub(instance);
    } else {
      // Short press: refresh status
      this.refreshStatus(context);
    }

    instance.keyDownTime = undefined;
  }

  private handleDidReceiveSettings(context: string, payload: { settings: ActionSettings }): void {
    const instance = this.actions.get(context);
    if (instance) {
      instance.settings = payload.settings;
      this.stopRefreshTimer(context);
      this.startRefreshTimer(context);
      this.refreshStatus(context);
    }
  }

  private getDefaultSettings(): ActionSettings {
    return {
      githubToken: '',
      owner: '',
      repo: '',
      workflow: '',
      refreshInterval: 60
    };
  }

  private startRefreshTimer(context: string): void {
    const instance = this.actions.get(context);
    if (!instance) return;

    const interval = (instance.settings.refreshInterval || 60) * 1000;

    instance.refreshTimer = setInterval(() => {
      this.refreshStatus(context);
    }, interval);
  }

  private stopRefreshTimer(context: string): void {
    const instance = this.actions.get(context);
    if (instance?.refreshTimer) {
      clearInterval(instance.refreshTimer);
      instance.refreshTimer = undefined;
    }
  }

  private async refreshStatus(context: string): Promise<void> {
    const instance = this.actions.get(context);
    if (!instance) return;

    const { githubToken, owner, repo, workflow } = instance.settings;

    if (!githubToken || !owner || !repo) {
      this.updateDisplay(context, 'unknown', 'Configure');
      return;
    }

    // Show loading state
    this.updateDisplay(context, 'pending', 'Loading...');

    const result = await fetchWorkflowStatus(githubToken, owner, repo, workflow);

    // Determine display text
    let displayText: string;
    if (result.error) {
      displayText = 'Error';
    } else {
      displayText = this.formatStatusText(result.status);
    }

    this.updateDisplay(context, result.status, displayText, result.updatedAt);
  }

  private formatStatusText(status: WorkflowStatus): string {
    switch (status) {
      case 'success':
        return 'Success';
      case 'failure':
        return 'Failed';
      case 'pending':
        return 'Running';
      default:
        return 'Unknown';
    }
  }

  private updateDisplay(context: string, status: WorkflowStatus, title: string, updatedAt?: string): void {
    const image = this.generateImage(status, updatedAt);

    this.send({
      event: 'setImage',
      context,
      payload: {
        image,
        target: 0 // Both hardware and software
      }
    });

    this.send({
      event: 'setTitle',
      context,
      payload: {
        title,
        target: 0
      }
    });
  }

  private openGitHub(instance: ActionInstance): void {
    const { owner, repo, workflow } = instance.settings;
    let url = `https://github.com/${owner}/${repo}/actions`;

    if (workflow) {
      url += `/workflows/${workflow}`;
    }

    this.send({
      event: 'openUrl',
      payload: {
        url
      }
    });
  }

  private send(data: Record<string, unknown>): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify(data));
    }
  }
}

// Entry point - Stream Deck passes arguments via command line
function main(): void {
  const args = process.argv.slice(2);
  let port: number | undefined;
  let pluginUUID: string | undefined;
  let registerEvent: string | undefined;
  let info: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '-port':
        port = parseInt(args[++i], 10);
        break;
      case '-pluginUUID':
        pluginUUID = args[++i];
        break;
      case '-registerEvent':
        registerEvent = args[++i];
        break;
      case '-info':
        info = args[++i];
        break;
    }
  }

  if (port && pluginUUID && registerEvent) {
    const plugin = new StreamDeckPlugin();
    plugin.connect(port, pluginUUID, registerEvent, info || '');
  } else {
    console.error('Missing required arguments');
    process.exit(1);
  }
}

main();
