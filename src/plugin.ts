import WebSocket from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import { fetchWorkflowStatus } from './github-api';
import { ActionInstance, ActionSettings, WorkflowStatus, WillAppearPayload, KeyDownPayload } from './types';

const LONG_PRESS_THRESHOLD = 500; // ms

class StreamDeckPlugin {
  private websocket: WebSocket | null = null;
  private actions: Map<string, ActionInstance> = new Map();
  private pluginUUID: string = '';
  private imagesCache: Map<string, string> = new Map();

  constructor() {
    this.loadImages();
  }

  private loadImages(): void {
    const imagesDir = path.join(__dirname, 'images');
    const statuses: WorkflowStatus[] = ['success', 'failure', 'pending', 'unknown'];

    for (const status of statuses) {
      const svgPath = path.join(imagesDir, `status-${status}.svg`);
      try {
        const svgContent = fs.readFileSync(svgPath, 'utf-8');
        const base64 = Buffer.from(svgContent).toString('base64');
        this.imagesCache.set(status, `data:image/svg+xml;base64,${base64}`);
      } catch {
        console.error(`Failed to load image: ${svgPath}`);
      }
    }
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

    this.updateDisplay(context, result.status, displayText);
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

  private updateDisplay(context: string, status: WorkflowStatus, title: string): void {
    const image = this.imagesCache.get(status);

    if (image) {
      this.send({
        event: 'setImage',
        context,
        payload: {
          image,
          target: 0 // Both hardware and software
        }
      });
    }

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
