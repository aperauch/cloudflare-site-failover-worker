import type {
  MonitorStateData,
  MaintenanceWindow,
  RedirectRuleHistoryEntry,
} from './types';

export class MonitorState implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    try {
      // Get state
      if (method === 'GET' && url.pathname === '/state') {
        const state = await this.getState();
        return new Response(JSON.stringify(state), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Update counters
      if (method === 'POST' && url.pathname === '/increment-failure') {
        const state = await this.getState();
        state.failureCount++;
        state.recoveryCount = 0;
        state.lastCheckTime = new Date().toISOString();
        state.failuresTotal++;
        state.healthChecksTotal++;
        await this.setState(state);
        return new Response(JSON.stringify(state), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'POST' && url.pathname === '/increment-recovery') {
        const state = await this.getState();
        state.recoveryCount++;
        state.failureCount = 0;
        state.lastCheckTime = new Date().toISOString();
        state.healthChecksTotal++;
        state.successesTotal++;
        await this.setState(state);
        return new Response(JSON.stringify(state), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'POST' && url.pathname === '/reset-counters') {
        const state = await this.getState();
        state.failureCount = 0;
        state.recoveryCount = 0;
        state.healthChecksTotal = 0;
        state.successesTotal = 0;
        state.failuresTotal = 0;
        state.redirectRuleChangesTotal = 0;
        state.apiErrorsTotal = 0;
        await this.setState(state);
        return new Response(JSON.stringify(state), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Update redirect rule state
      if (method === 'POST' && url.pathname === '/update-redirect-rule-state') {
        const body = await request.json() as { enabled: boolean; reason: string };
        const state = await this.getState();
        state.redirectRuleEnabled = body.enabled;
        state.redirectRuleChangesTotal++;
        
        // Add to history
        state.redirectRuleHistory.unshift({
          timestamp: new Date().toISOString(),
          event: body.enabled ? 'enabled' : 'disabled',
          reason: body.reason,
          failureCount: state.failureCount,
          recoveryCount: state.recoveryCount,
        });
        
        // Keep only last 50 entries
        if (state.redirectRuleHistory.length > 50) {
          state.redirectRuleHistory = state.redirectRuleHistory.slice(0, 50);
        }

        await this.setState(state);
        return new Response(JSON.stringify(state), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Maintenance mode
      if (method === 'POST' && url.pathname === '/set-maintenance-mode') {
        const body = await request.json() as { enabled: boolean; reason?: string };
        const state = await this.getState();
        state.maintenanceMode = body.enabled;
        state.maintenanceModeReason = body.reason;
        await this.setState(state);
        return new Response(JSON.stringify(state), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Maintenance windows
      if (method === 'POST' && url.pathname === '/add-maintenance-window') {
        const body = await request.json() as MaintenanceWindow;
        const state = await this.getState();
        state.scheduledMaintenanceWindows.push(body);
        await this.setState(state);
        return new Response(JSON.stringify(state), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'DELETE' && url.pathname.startsWith('/delete-maintenance-window/')) {
        const windowId = url.pathname.split('/').pop();
        const state = await this.getState();
        state.scheduledMaintenanceWindows = state.scheduledMaintenanceWindows.filter(
          w => w.id !== windowId
        );
        await this.setState(state);
        return new Response(JSON.stringify(state), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Clean expired maintenance windows
      if (method === 'POST' && url.pathname === '/clean-maintenance-windows') {
        const state = await this.getState();
        const now = new Date();
        state.scheduledMaintenanceWindows = state.scheduledMaintenanceWindows.filter(
          w => new Date(w.endTime) > now
        );
        await this.setState(state);
        return new Response(JSON.stringify(state), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Increment metrics
      if (method === 'POST' && url.pathname === '/increment-api-errors') {
        const state = await this.getState();
        state.apiErrorsTotal++;
        await this.setState(state);
        return new Response(JSON.stringify(state), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'POST' && url.pathname === '/update-cron-execution') {
        const state = await this.getState();
        state.lastCronExecution = new Date().toISOString();
        await this.setState(state);
        return new Response(JSON.stringify(state), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Disable API calls
      if (method === 'POST' && url.pathname === '/disable-api-calls') {
        const state = await this.getState();
        state.apiCallsDisabled = true;
        await this.setState(state);
        return new Response(JSON.stringify(state), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Simulate failover/recovery
      if (method === 'POST' && url.pathname === '/simulate-failover') {
        const body = await request.json() as { threshold: number };
        const state = await this.getState();
        state.failureCount = body.threshold;
        state.recoveryCount = 0;
        await this.setState(state);
        return new Response(JSON.stringify(state), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'POST' && url.pathname === '/simulate-recovery') {
        const body = await request.json() as { threshold: number };
        const state = await this.getState();
        state.recoveryCount = body.threshold;
        state.failureCount = 0;
        await this.setState(state);
        return new Response(JSON.stringify(state), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  private async getState(): Promise<MonitorStateData> {
    const data = await this.state.storage.get<MonitorStateData>('state');
    
    if (!data) {
      // Initialize with default values
      const defaultState: MonitorStateData = {
        failureCount: 0,
        recoveryCount: 0,
        lastCheckTime: null,
        redirectRuleEnabled: false,
        maintenanceMode: false,
        scheduledMaintenanceWindows: [],
        redirectRuleHistory: [],
        healthChecksTotal: 0,
        successesTotal: 0,
        failuresTotal: 0,
        redirectRuleChangesTotal: 0,
        apiErrorsTotal: 0,
        lastCronExecution: null,
        workerStartTime: new Date().toISOString(),
        apiCallsDisabled: false,
      };
      
      await this.setState(defaultState);
      return defaultState;
    }
    
    return data;
  }

  private async setState(state: MonitorStateData): Promise<void> {
    await this.state.storage.put('state', state);
  }
}
