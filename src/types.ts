// Environment variables
export interface Env {
  MONITOR_URL: string;
  FAILURE_COUNT_THRESHOLD: string;
  RECOVERY_COUNT_THRESHOLD: string;
  TIMEOUT_SECONDS: string;
  REDIRECT_RULE_ID: string;
  ACCOUNT_ID: string;
  ZONE_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  LOG_LEVEL?: string;
  API_TOKEN: string;
  MONITOR_STATE: DurableObjectNamespace;
}

// State stored in Durable Objects
export interface MonitorStateData {
  failureCount: number;
  recoveryCount: number;
  lastCheckTime: string | null;
  redirectRuleEnabled: boolean;
  maintenanceMode: boolean;
  maintenanceModeReason?: string;
  scheduledMaintenanceWindows: MaintenanceWindow[];
  redirectRuleHistory: RedirectRuleHistoryEntry[];
  healthChecksTotal: number;
  successesTotal: number;
  failuresTotal: number;
  redirectRuleChangesTotal: number;
  apiErrorsTotal: number;
  lastCronExecution: string | null;
  workerStartTime: string;
  apiCallsDisabled: boolean; // If authentication fails
}

export interface MaintenanceWindow {
  id: string;
  startTime: string;
  endTime: string;
  reason?: string;
}

export interface RedirectRuleHistoryEntry {
  timestamp: string;
  event: 'enabled' | 'disabled';
  reason: string;
  failureCount: number;
  recoveryCount: number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ValidatedConfig {
  monitorUrl: string;
  failureCountThreshold: number;
  recoveryCountThreshold: number;
  timeoutSeconds: number;
  redirectRuleId: string;
  accountId: string;
  zoneId: string;
  cloudflareApiToken: string;
  logLevel: LogLevel;
  apiToken: string;
}
