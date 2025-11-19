import type { MonitorStateData, MaintenanceWindow } from './types';

export class StateManager {
  private durableObject: DurableObjectStub;

  constructor(durableObjectNamespace: DurableObjectNamespace, objectId: string = 'monitor-state') {
    const id = durableObjectNamespace.idFromName(objectId);
    this.durableObject = durableObjectNamespace.get(id);
  }

  async getState(): Promise<MonitorStateData> {
    const response = await this.durableObject.fetch('http://do/state');
    if (!response.ok) {
      throw new Error('Failed to get state from Durable Object');
    }
    return await response.json();
  }

  async incrementFailure(): Promise<MonitorStateData> {
    const response = await this.durableObject.fetch('http://do/increment-failure', {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to increment failure counter');
    }
    return await response.json();
  }

  async incrementRecovery(): Promise<MonitorStateData> {
    const response = await this.durableObject.fetch('http://do/increment-recovery', {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to increment recovery counter');
    }
    return await response.json();
  }

  async resetCounters(): Promise<MonitorStateData> {
    const response = await this.durableObject.fetch('http://do/reset-counters', {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to reset counters');
    }
    return await response.json();
  }

  async resetAllMetrics(): Promise<MonitorStateData> {
    const response = await this.durableObject.fetch('http://do/reset-all-metrics', {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to reset all metrics');
    }
    return await response.json();
  }

  async updateRedirectRuleState(enabled: boolean, reason: string): Promise<MonitorStateData> {
    const response = await this.durableObject.fetch('http://do/update-redirect-rule-state', {
      method: 'POST',
      body: JSON.stringify({ enabled, reason }),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error('Failed to update redirect rule state');
    }
    return await response.json();
  }

  async setMaintenanceMode(enabled: boolean, reason?: string): Promise<MonitorStateData> {
    const response = await this.durableObject.fetch('http://do/set-maintenance-mode', {
      method: 'POST',
      body: JSON.stringify({ enabled, reason }),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error('Failed to set maintenance mode');
    }
    return await response.json();
  }

  async addMaintenanceWindow(window: MaintenanceWindow): Promise<MonitorStateData> {
    const response = await this.durableObject.fetch('http://do/add-maintenance-window', {
      method: 'POST',
      body: JSON.stringify(window),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error('Failed to add maintenance window');
    }
    return await response.json();
  }

  async deleteMaintenanceWindow(windowId: string): Promise<MonitorStateData> {
    const response = await this.durableObject.fetch(`http://do/delete-maintenance-window/${windowId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete maintenance window');
    }
    return await response.json();
  }

  async cleanMaintenanceWindows(): Promise<MonitorStateData> {
    const response = await this.durableObject.fetch('http://do/clean-maintenance-windows', {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to clean maintenance windows');
    }
    return await response.json();
  }

  async incrementApiErrors(): Promise<MonitorStateData> {
    const response = await this.durableObject.fetch('http://do/increment-api-errors', {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to increment API errors');
    }
    return await response.json();
  }

  async updateCronExecution(): Promise<MonitorStateData> {
    const response = await this.durableObject.fetch('http://do/update-cron-execution', {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to update cron execution');
    }
    return await response.json();
  }

  async disableApiCalls(): Promise<MonitorStateData> {
    const response = await this.durableObject.fetch('http://do/disable-api-calls', {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to disable API calls');
    }
    return await response.json();
  }

  async simulateFailover(threshold: number): Promise<MonitorStateData> {
    const response = await this.durableObject.fetch('http://do/simulate-failover', {
      method: 'POST',
      body: JSON.stringify({ threshold }),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error('Failed to simulate failover');
    }
    return await response.json();
  }

  async simulateRecovery(threshold: number): Promise<MonitorStateData> {
    const response = await this.durableObject.fetch('http://do/simulate-recovery', {
      method: 'POST',
      body: JSON.stringify({ threshold }),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error('Failed to simulate recovery');
    }
    return await response.json();
  }
}
