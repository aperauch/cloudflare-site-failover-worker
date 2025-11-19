import { Hono } from 'hono';
import { swaggerUI } from '@hono/swagger-ui';
import type { Env, MaintenanceWindow } from './types';
import { Logger } from './logger';
import { validateEnvironment, ValidationError } from './validation';
import { CloudflareAPIClient } from './cloudflare-api';
import { StateManager } from './state-manager';
import { RateLimiter } from './rate-limiter';
import { getOpenAPIApp } from './openapi-routes';

const app = new Hono<{ Bindings: Env }>();

// Mount OpenAPI routes
const apiApp = getOpenAPIApp();
app.route('/', apiApp);

// Add Swagger UI at root
app.get(
  '/',
  swaggerUI({
    url: '/openapi.json',
  })
);

// Global logger instance
let globalLogger: Logger | null = null;
let validatedConfig: any = null;

// Rate limiter instance
const rateLimiter = new RateLimiter(60, 1); // 60 requests per minute

// Middleware for rate limiting
const rateLimitMiddleware = async (c: any, next: any) => {
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const result = rateLimiter.check(ip);
  
  if (!result.allowed) {
    return c.json(
      { error: 'Rate limit exceeded' },
      429,
      result.retryAfter ? { 'Retry-After': result.retryAfter.toString() } : {}
    );
  }
  
  await next();
};

// Middleware for authentication
const authMiddleware = (c: any, next: any) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token || token !== c.env.API_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  return next();
};

// Health check endpoint (no auth required)
app.get('/health', async (c) => {
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
      status: 'unhealthy',
      durableObjectsAvailable: false,
      lastCronExecution: null,
      uptimeSeconds: 0,
      error: error.message,
    }, 503);
  }
});

// Apply authentication and rate limiting to all other routes
app.use('*', rateLimitMiddleware);
app.use('*', authMiddleware);

// GET /status
app.get('/status', async (c) => {
  try {
    const stateManager = new StateManager(c.env.MONITOR_STATE);
    const state = await stateManager.getState();
    
    const config = validatedConfig || validateEnvironment(c.env, new Logger());
    
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

// GET /metrics
app.get('/metrics', async (c) => {
  try {
    const stateManager = new StateManager(c.env.MONITOR_STATE);
    const state = await stateManager.getState();
    
    const metrics = [
      `# HELP health_checks_total Total number of health checks performed`,
      `# TYPE health_checks_total counter`,
      `health_checks_total ${state.healthChecksTotal}`,
      ``,
      `# HELP failures_total Total number of failures detected`,
      `# TYPE failures_total counter`,
      `failures_total ${state.failuresTotal}`,
      ``,
      `# HELP redirect_rule_changes_total Total number of redirect rule changes`,
      `# TYPE redirect_rule_changes_total counter`,
      `redirect_rule_changes_total ${state.redirectRuleChangesTotal}`,
      ``,
      `# HELP api_errors_total Total number of API errors`,
      `# TYPE api_errors_total counter`,
      `api_errors_total ${state.apiErrorsTotal}`,
      ``,
    ].join('\n');
    
    return c.text(metrics);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// GET /redirect-rule
app.get('/redirect-rule', async (c) => {
  try {
    const config = validatedConfig || validateEnvironment(c.env, new Logger());
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

// GET /redirect-rule-history
app.get('/redirect-rule-history', async (c) => {
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

// POST /simulate-failover
app.post('/simulate-failover', async (c) => {
  try {
    const config = validatedConfig || validateEnvironment(c.env, new Logger());
    const stateManager = new StateManager(c.env.MONITOR_STATE);
    
    const state = await stateManager.simulateFailover(config.failureCountThreshold);
    
    return c.json({
      success: true,
      newFailureCount: state.failureCount,
      message: `Failure counter set to ${state.failureCount}`,
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// POST /simulate-recovery
app.post('/simulate-recovery', async (c) => {
  try {
    const config = validatedConfig || validateEnvironment(c.env, new Logger());
    const stateManager = new StateManager(c.env.MONITOR_STATE);
    
    const state = await stateManager.simulateRecovery(config.recoveryCountThreshold);
    
    return c.json({
      success: true,
      newRecoveryCount: state.recoveryCount,
      message: `Recovery counter set to ${state.recoveryCount}`,
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// POST /reset-counters
app.post('/reset-counters', async (c) => {
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

// POST /maintenance-mode
app.post('/maintenance-mode', async (c) => {
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

// POST /maintenance-window
app.post('/maintenance-window', async (c) => {
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

// GET /maintenance-windows
app.get('/maintenance-windows', async (c) => {
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

// DELETE /maintenance-window/:windowId
app.delete('/maintenance-window/:windowId', async (c) => {
  try {
    const windowId = c.req.param('windowId');
    
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

// Cron trigger handler
async function handleScheduled(env: Env) {
  const logger = new Logger((env.LOG_LEVEL || 'debug') as any);
  
  try {
    // Validate environment on first run
    if (!validatedConfig) {
      try {
        validatedConfig = validateEnvironment(env, logger);
        globalLogger = new Logger(validatedConfig.logLevel);
      } catch (error) {
        if (error instanceof ValidationError) {
          logger.error('Worker refusing to start due to validation errors');
          return;
        }
        throw error;
      }
    }
    
    const config = validatedConfig;
    const stateManager = new StateManager(env.MONITOR_STATE);
    
    // Update cron execution time
    await stateManager.updateCronExecution();
    
    // Clean up expired maintenance windows
    await stateManager.cleanMaintenanceWindows();
    
    // Get current state
    const state = await stateManager.getState();
    
    // Check if API calls are disabled
    if (state.apiCallsDisabled) {
      logger.warn('API calls are disabled due to previous authentication failure');
      return;
    }
    
    // Check if in maintenance mode
    const now = new Date();
    const isInMaintenanceWindow = state.scheduledMaintenanceWindows.some(
      w => now >= new Date(w.startTime) && now <= new Date(w.endTime)
    );
    const maintenanceModeActive = state.maintenanceMode || isInMaintenanceWindow;
    
    // Perform health check
    logger.debug(`Checking health of ${config.monitorUrl}`);
    
    let isHealthy = false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeoutSeconds * 1000);
      
      const response = await fetch(config.monitorUrl, {
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.status === 200) {
        isHealthy = true;
        logger.info('Health check passed');
      } else {
        logger.warn(`Health check failed with status ${response.status}`);
      }
    } catch (error: any) {
      logger.warn('Health check failed', { error: error.message });
    }
    
    // Update counters
    if (isHealthy) {
      const newState = await stateManager.incrementRecovery();
      logger.debug(`Recovery count: ${newState.recoveryCount}`);
      
      // Check if we should disable the redirect rule
      if (newState.recoveryCount >= config.recoveryCountThreshold && state.redirectRuleEnabled) {
        if (maintenanceModeActive) {
          logger.info(
            `Would disable redirect rule (recovery threshold reached) but maintenance mode is active`
          );
        } else {
          logger.info('Recovery threshold reached, disabling redirect rule');
          
          const apiClient = new CloudflareAPIClient(
            config.cloudflareApiToken,
            config.zoneId,
            config.accountId,
            logger
          );
          
          try {
            const success = await apiClient.updateRedirectRule(config.redirectRuleId, false);
            
            if (success) {
              await stateManager.updateRedirectRuleState(
                false,
                `Recovery threshold reached (${config.recoveryCountThreshold} consecutive successes)`
              );
            } else {
              await stateManager.incrementApiErrors();
            }
          } catch (error: any) {
            if (error.message === 'AUTHENTICATION_FAILED') {
              await stateManager.disableApiCalls();
            } else {
              await stateManager.incrementApiErrors();
            }
          }
        }
      }
    } else {
      const newState = await stateManager.incrementFailure();
      logger.debug(`Failure count: ${newState.failureCount}`);
      
      // Check if we should enable the redirect rule
      if (newState.failureCount >= config.failureCountThreshold && !state.redirectRuleEnabled) {
        if (maintenanceModeActive) {
          logger.info(
            `Would enable redirect rule (failure threshold reached) but maintenance mode is active`
          );
        } else {
          logger.info('Failure threshold reached, enabling redirect rule');
          
          const apiClient = new CloudflareAPIClient(
            config.cloudflareApiToken,
            config.zoneId,
            config.accountId,
            logger
          );
          
          try {
            const success = await apiClient.updateRedirectRule(config.redirectRuleId, true);
            
            if (success) {
              await stateManager.updateRedirectRuleState(
                true,
                `Failure threshold reached (${config.failureCountThreshold} consecutive failures)`
              );
            } else {
              await stateManager.incrementApiErrors();
            }
          } catch (error: any) {
            if (error.message === 'AUTHENTICATION_FAILED') {
              await stateManager.disableApiCalls();
            } else {
              await stateManager.incrementApiErrors();
            }
          }
        }
      }
    }
  } catch (error: any) {
    logger.error('Cron execution failed', { error: error.message });
  }
}

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(handleScheduled(env));
  },
};

// Export the Durable Object class
export { MonitorState } from './durable-object';
