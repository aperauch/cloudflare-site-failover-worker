import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Env, MaintenanceWindow } from './types';
import { StateManager } from './state-manager';
import { validateEnvironment } from './validation';
import { CloudflareAPIClient } from './cloudflare-api';
import { Logger } from './logger';

// Schema definitions
const StatusResponseSchema = z.object({
  monitorUrl: z.string().describe('URL being monitored for health checks'),
  failureCount: z.number().describe('Current consecutive failures (resets to 0 after redirect rule is enabled or after recovery)'),
  recoveryCount: z.number().describe('Current consecutive successes (resets to 0 after redirect rule is disabled or after failure)'),
  lastCheckTime: z.string().nullable().describe('ISO8601 timestamp of last health check execution'),
  nextCheckTime: z.string().describe('ISO8601 timestamp of next scheduled cron execution'),
  redirectRuleEnabled: z.boolean().describe('Current state of redirect rule (true = enabled/active, false = disabled/inactive)'),
  maintenanceMode: z.boolean().describe('Whether immediate maintenance mode is currently active (bypasses health checks)'),
  scheduledMaintenanceWindows: z.array(z.object({
    id: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    reason: z.string().optional(),
  })),
  thresholds: z.object({
    failureCountThreshold: z.number(),
    recoveryCountThreshold: z.number(),
    timeoutSeconds: z.number(),
  }),
});

const HealthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']).describe('Worker health status'),
  durableObjectsAvailable: z.boolean().describe('Whether Durable Objects are accessible'),
  lastCronExecution: z.string().nullable().describe('ISO8601 timestamp of last cron execution'),
  uptimeSeconds: z.number().describe('Worker uptime in seconds'),
  error: z.string().optional(),
});

const RedirectRuleResponseSchema = z.object({
  id: z.string().describe('Cloudflare rule ID'),
  status: z.enum(['active', 'inactive']).describe('Current rule status: active (enabled) or inactive (disabled)'),
  lastModified: z.string().describe('ISO8601 timestamp when rule was last modified in Cloudflare'),
  lastChecked: z.string().describe('ISO8601 timestamp when this status was fetched'),
});

const RedirectRuleHistorySchema = z.object({
  history: z.array(z.object({
    timestamp: z.string(),
    event: z.enum(['enabled', 'disabled']),
    reason: z.string(),
    failureCount: z.number(),
    recoveryCount: z.number(),
  })),
});

const SuccessResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const SimulateResponseSchema = z.object({
  success: z.boolean(),
  newFailureCount: z.number().optional(),
  newRecoveryCount: z.number().optional(),
  message: z.string(),
});

const MaintenanceModeRequestSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().optional(),
});

const MaintenanceModeResponseSchema = z.object({
  success: z.boolean(),
  maintenanceMode: z.boolean(),
  message: z.string(),
});

const MaintenanceWindowRequestSchema = z.object({
  startTime: z.string().describe('ISO8601 start time'),
  endTime: z.string().describe('ISO8601 end time'),
  reason: z.string().optional(),
});

const MaintenanceWindowResponseSchema = z.object({
  success: z.boolean(),
  windowId: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  message: z.string(),
});

const MaintenanceWindowsResponseSchema = z.object({
  windows: z.array(z.object({
    id: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    reason: z.string().optional(),
    isActive: z.boolean(),
  })),
});

const ErrorResponseSchema = z.object({
  error: z.string(),
});

// Create OpenAPI app
export const api = new OpenAPIHono<{ Bindings: Env }>();

// Authentication middleware
api.use('*', async (c, next) => {
  // Skip auth for health endpoint and OpenAPI docs
  if (c.req.path === '/health' || c.req.path === '/openapi.json' || c.req.path === '/ui' || c.req.path === '/') {
    return next();
  }
  
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized - Bearer token required' }, 401);
  }
  
  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  if (token !== c.env.API_TOKEN) {
    return c.json({ error: 'Unauthorized - Invalid token' }, 401);
  }
  
  return next();
});

// Register security scheme
api.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'string',
  description: 'Enter your API token (matches API_TOKEN environment variable)',
});

// Health endpoint (no auth)
const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Monitoring'],
  summary: 'Get worker health status',
  description: 'Returns operational health of the worker. No authentication required.',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: HealthResponseSchema,
        },
      },
      description: 'Health status',
    },
    503: {
      content: {
        'application/json': {
          schema: HealthResponseSchema,
        },
      },
      description: 'Service unavailable',
    },
  },
});

api.openapi(healthRoute, async (c) => {
  try {
    const stateManager = new StateManager(c.env.MONITOR_STATE);
    const state = await stateManager.getState();
    
    const now = new Date();
    const uptimeSeconds = state.workerStartTime 
      ? Math.floor((now.getTime() - new Date(state.workerStartTime).getTime()) / 1000)
      : 0;
    
    const lastCronAge = state.lastCronExecution
      ? Math.floor((now.getTime() - new Date(state.lastCronExecution).getTime()) / 1000)
      : null;
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (!state.lastCronExecution) {
      status = 'degraded';
    } else if (lastCronAge && lastCronAge > 120) {
      status = 'unhealthy';
    }
    
    return c.json({
      status,
      durableObjectsAvailable: true,
      lastCronExecution: state.lastCronExecution,
      uptimeSeconds,
    });
  } catch (error: any) {
    return c.json({
      status: 'unhealthy' as const,
      durableObjectsAvailable: false,
      lastCronExecution: null,
      uptimeSeconds: 0,
      error: error.message,
    }, 503);
  }
});

// Status endpoint
const statusRoute = createRoute({
  method: 'get',
  path: '/status',
  tags: ['Monitoring'],
  summary: 'Get monitoring status',
  description: 'Returns current monitoring status including counters and thresholds.',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: StatusResponseSchema,
        },
      },
      description: 'Current status',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized',
    },
    500: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Internal error',
    },
  },
});

api.openapi(statusRoute, async (c) => {
  try {
    const stateManager = new StateManager(c.env.MONITOR_STATE);
    const state = await stateManager.getState();
    
    const config = validateEnvironment(c.env, new Logger());
    
    const now = new Date();
    const nextCheckTime = state.lastCheckTime
      ? new Date(new Date(state.lastCheckTime).getTime() + 60000).toISOString()
      : new Date(now.getTime() + 60000).toISOString();
    
    return c.json({
      monitorUrl: config.monitorUrl,
      failureCount: state.failureCount,
      recoveryCount: state.recoveryCount,
      lastCheckTime: state.lastCheckTime,
      nextCheckTime,
      redirectRuleEnabled: state.redirectRuleEnabled,
      maintenanceMode: state.maintenanceMode,
      scheduledMaintenanceWindows: state.scheduledMaintenanceWindows,
      thresholds: {
        failureCountThreshold: config.failureCountThreshold,
        recoveryCountThreshold: config.recoveryCountThreshold,
        timeoutSeconds: config.timeoutSeconds,
      },
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Metrics endpoint
const MetricsResponseSchema = z.object({
  healthChecksTotal: z.number().describe('Cumulative count of all health checks performed since deployment'),
  successesTotal: z.number().describe('Cumulative count of successful health checks (target responded with 2xx status)'),
  failuresTotal: z.number().describe('Cumulative count of failed health checks (timeouts, errors, non-2xx responses)'),
  redirectRuleChangesTotal: z.number().describe('Cumulative count of redirect rule enable/disable operations'),
  apiErrorsTotal: z.number().describe('Cumulative count of Cloudflare API errors encountered'),
});

const metricsRoute = createRoute({
  method: 'get',
  path: '/metrics',
  tags: ['Monitoring'],
  summary: 'Get cumulative metrics',
  description: 'Returns cumulative monitoring metrics tracked since deployment. These counters continuously increment and are persisted in Durable Objects. Use /reset-all-metrics to reset for testing.',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: MetricsResponseSchema,
        },
      },
      description: 'Monitoring metrics',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized',
    },
  },
});

api.openapi(metricsRoute, async (c) => {
  try {
    const stateManager = new StateManager(c.env.MONITOR_STATE);
    const state = await stateManager.getState();
    
    return c.json({
      healthChecksTotal: state.healthChecksTotal,
      successesTotal: state.successesTotal,
      failuresTotal: state.failuresTotal,
      redirectRuleChangesTotal: state.redirectRuleChangesTotal,
      apiErrorsTotal: state.apiErrorsTotal,
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Redirect rule endpoint
const redirectRuleRoute = createRoute({
  method: 'get',
  path: '/redirect-rule',
  tags: ['Redirect Rules'],
  summary: 'Get redirect rule status',
  description: 'Fetches the current redirect rule state directly from Cloudflare API. Returns real-time status including whether the rule is currently active (enabled) or inactive (disabled), the rule ID, and when it was last modified.',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: RedirectRuleResponseSchema,
        },
      },
      description: 'Redirect rule info',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Unauthorized',
    },
    500: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Failed to fetch rule',
    },
  },
});

api.openapi(redirectRuleRoute, async (c) => {
  try {
    const config = validateEnvironment(c.env, new Logger());
    const logger = new Logger(config.logLevel);
    const apiClient = new CloudflareAPIClient(
      config.cloudflareApiToken,
      config.zoneId,
      config.accountId,
      logger
    );
    
    const rule = await apiClient.getRedirectRule(config.redirectRuleId);
    
    if (!rule) {
      return c.json({ error: 'Failed to fetch redirect rule' }, 500);
    }
    
    return c.json({
      id: rule.id,
      status: rule.status,
      lastModified: rule.lastModified,
      lastChecked: new Date().toISOString(),
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Redirect rule history endpoint
const redirectRuleHistoryRoute = createRoute({
  method: 'get',
  path: '/redirect-rule-history',
  tags: ['Redirect Rules'],
  summary: 'Get redirect rule change history',
  description: 'Returns last 50 redirect rule state changes.',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: RedirectRuleHistorySchema,
        },
      },
      description: 'Change history',
    },
  },
});

api.openapi(redirectRuleHistoryRoute, async (c) => {
  try {
    const stateManager = new StateManager(c.env.MONITOR_STATE);
    const state = await stateManager.getState();
    
    return c.json({
      history: state.redirectRuleHistory,
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Simulate failover endpoint
const simulateFailoverRoute = createRoute({
  method: 'post',
  path: '/simulate-failover',
  tags: ['Testing'],
  summary: 'Simulate failover (enable redirect rule)',
  description: 'Immediately enables the redirect rule via Cloudflare API to simulate a failover scenario. Use this to test your failover configuration without waiting for actual failures. Resets failure/recovery counters after successful activation.',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: SimulateResponseSchema,
        },
      },
      description: 'Failover simulated',
    },
  },
});

api.openapi(simulateFailoverRoute, async (c) => {
  try {
    const logger = new Logger((c.env.LOG_LEVEL || 'info') as any);
    const config = validateEnvironment(c.env, logger);
    const stateManager = new StateManager(c.env.MONITOR_STATE);
    
    // Set failure counter to threshold
    const state = await stateManager.simulateFailover(config.failureCountThreshold);
    
    // Actually enable the redirect rule via API
    const apiClient = new CloudflareAPIClient(
      config.cloudflareApiToken,
      config.zoneId,
      config.accountId,
      logger
    );
    
    const success = await apiClient.updateRedirectRule(config.redirectRuleId, true);
    
    if (success) {
      await stateManager.updateRedirectRuleState(
        true,
        'Simulated failover - manually triggered via API'
      );
      await stateManager.resetCounters();
      
      return c.json({
        success: true,
        newFailureCount: 0,
        message: 'Redirect rule enabled successfully',
      });
    } else {
      await stateManager.incrementApiErrors();
      return c.json({
        success: false,
        message: 'Failed to enable redirect rule via Cloudflare API',
      }, 500);
    }
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Simulate recovery endpoint
const simulateRecoveryRoute = createRoute({
  method: 'post',
  path: '/simulate-recovery',
  tags: ['Testing'],
  summary: 'Simulate recovery (disable redirect rule)',
  description: 'Immediately disables the redirect rule via Cloudflare API to simulate a recovery scenario. Use this to test recovery behavior without waiting for successful health checks. Resets failure/recovery counters after successful deactivation.',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: SimulateResponseSchema,
        },
      },
      description: 'Recovery simulated',
    },
  },
});

api.openapi(simulateRecoveryRoute, async (c) => {
  try {
    const logger = new Logger((c.env.LOG_LEVEL || 'info') as any);
    const config = validateEnvironment(c.env, logger);
    const stateManager = new StateManager(c.env.MONITOR_STATE);
    
    // Set recovery counter to threshold
    const state = await stateManager.simulateRecovery(config.recoveryCountThreshold);
    
    // Actually disable the redirect rule via API
    const apiClient = new CloudflareAPIClient(
      config.cloudflareApiToken,
      config.zoneId,
      config.accountId,
      logger
    );
    
    const success = await apiClient.updateRedirectRule(config.redirectRuleId, false);
    
    if (success) {
      await stateManager.updateRedirectRuleState(
        false,
        'Simulated recovery - manually triggered via API'
      );
      await stateManager.resetCounters();
      
      return c.json({
        success: true,
        newRecoveryCount: 0,
        message: 'Redirect rule disabled successfully',
      });
    } else {
      await stateManager.incrementApiErrors();
      return c.json({
        success: false,
        message: 'Failed to disable redirect rule via Cloudflare API',
      }, 500);
    }
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Reset counters endpoint
const resetCountersRoute = createRoute({
  method: 'post',
  path: '/reset-counters',
  tags: ['Management'],
  summary: 'Reset failure and recovery counters',
  description: 'Resets ONLY the consecutive failure and recovery counters to zero. All cumulative metrics (healthChecksTotal, successesTotal, etc.) are preserved and continue accumulating. Use this to clear consecutive counters without losing historical data.',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: SuccessResponseSchema,
        },
      },
      description: 'Counters reset',
    },
  },
});

api.openapi(resetCountersRoute, async (c) => {
  try {
    const stateManager = new StateManager(c.env.MONITOR_STATE);
    await stateManager.resetCounters();
    
    return c.json({
      success: true,
      message: 'Counters reset successfully',
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Reset all metrics endpoint (for debugging)
const resetAllMetricsRoute = createRoute({
  method: 'post',
  path: '/reset-all-metrics',
  tags: ['Management'],
  summary: 'Reset all metrics (testing only)',
  description: 'Resets EVERYTHING: consecutive counters AND all cumulative metrics (healthChecksTotal, successesTotal, failuresTotal, redirectRuleChangesTotal, apiErrorsTotal) back to zero. ⚠️ WARNING: This erases all historical metric data. Use only for testing or debugging purposes.',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: SuccessResponseSchema,
        },
      },
      description: 'All metrics reset',
    },
  },
});

api.openapi(resetAllMetricsRoute, async (c) => {
  try {
    const stateManager = new StateManager(c.env.MONITOR_STATE);
    await stateManager.resetAllMetrics();
    
    return c.json({
      success: true,
      message: 'All metrics reset successfully',
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Maintenance mode endpoint
const maintenanceModeRoute = createRoute({
  method: 'post',
  path: '/maintenance-mode',
  tags: ['Maintenance'],
  summary: 'Set maintenance mode',
  description: 'Enable or disable maintenance mode.',
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: MaintenanceModeRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: MaintenanceModeResponseSchema,
        },
      },
      description: 'Maintenance mode updated',
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Invalid request',
    },
  },
});

api.openapi(maintenanceModeRoute, async (c) => {
  try {
    const body = await c.req.json();
    const { enabled, reason } = body;
    
    if (typeof enabled !== 'boolean') {
      return c.json({ error: 'enabled must be a boolean' }, 400);
    }
    
    const stateManager = new StateManager(c.env.MONITOR_STATE);
    const state = await stateManager.setMaintenanceMode(enabled, reason);
    
    return c.json({
      success: true,
      maintenanceMode: state.maintenanceMode,
      message: enabled ? 'Maintenance mode enabled' : 'Maintenance mode disabled',
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Add maintenance window endpoint
const addMaintenanceWindowRoute = createRoute({
  method: 'post',
  path: '/maintenance-window',
  tags: ['Maintenance'],
  summary: 'Schedule maintenance window',
  description: 'Schedule a maintenance window during which redirect rule changes are blocked.',
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: MaintenanceWindowRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: MaintenanceWindowResponseSchema,
        },
      },
      description: 'Maintenance window scheduled',
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Invalid request',
    },
  },
});

api.openapi(addMaintenanceWindowRoute, async (c) => {
  try {
    const body = await c.req.json();
    const { startTime, endTime, reason } = body;
    
    if (!startTime || !endTime) {
      return c.json({ error: 'startTime and endTime are required' }, 400);
    }
    
    const window: MaintenanceWindow = {
      id: crypto.randomUUID(),
      startTime,
      endTime,
      reason,
    };
    
    const stateManager = new StateManager(c.env.MONITOR_STATE);
    await stateManager.addMaintenanceWindow(window);
    
    return c.json({
      success: true,
      windowId: window.id,
      startTime: window.startTime,
      endTime: window.endTime,
      message: 'Maintenance window scheduled',
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Get maintenance windows endpoint
const getMaintenanceWindowsRoute = createRoute({
  method: 'get',
  path: '/maintenance-windows',
  tags: ['Maintenance'],
  summary: 'Get maintenance windows',
  description: 'Returns all scheduled maintenance windows.',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: MaintenanceWindowsResponseSchema,
        },
      },
      description: 'Maintenance windows',
    },
  },
});

api.openapi(getMaintenanceWindowsRoute, async (c) => {
  try {
    const stateManager = new StateManager(c.env.MONITOR_STATE);
    const state = await stateManager.getState();
    
    const now = new Date();
    const windows = state.scheduledMaintenanceWindows.map(w => ({
      ...w,
      isActive: now >= new Date(w.startTime) && now <= new Date(w.endTime),
    }));
    
    return c.json({ windows });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Delete maintenance window endpoint
const deleteMaintenanceWindowRoute = createRoute({
  method: 'delete',
  path: '/maintenance-window/{windowId}',
  tags: ['Maintenance'],
  summary: 'Cancel maintenance window',
  description: 'Cancels a scheduled maintenance window.',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      windowId: z.string(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: SuccessResponseSchema,
        },
      },
      description: 'Maintenance window cancelled',
    },
  },
});

api.openapi(deleteMaintenanceWindowRoute, async (c) => {
  try {
    const { windowId } = c.req.param();
    
    const stateManager = new StateManager(c.env.MONITOR_STATE);
    await stateManager.deleteMaintenanceWindow(windowId);
    
    return c.json({
      success: true,
      message: 'Maintenance window cancelled',
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Configure OpenAPI documentation
api.doc('/openapi.json', (c) => {
  const url = new URL(c.req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  
  return {
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'Site Failover Worker API',
      description: 'Automated website health monitoring and failover management system for Cloudflare',
    },
    servers: [
      {
        url: baseUrl,
        description: url.hostname === 'localhost' ? 'Local development' : 'Production',
      },
    ],
    tags: [
      { name: 'Monitoring', description: 'Health and status monitoring' },
      { name: 'Redirect Rules', description: 'Cloudflare redirect rule management' },
      { name: 'Testing', description: 'Testing and simulation endpoints' },
      { name: 'Management', description: 'Counter and state management' },
      { name: 'Maintenance', description: 'Maintenance mode management' },
    ],
  };
});

export function getOpenAPIApp() {
  return api;
}
