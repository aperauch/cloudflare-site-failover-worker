import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { apiReference } from '@scalar/hono-api-reference';
import type { Env } from './types';
import { Logger } from './logger';
import { validateEnvironment, ValidationError } from './validation';
import { CloudflareAPIClient } from './cloudflare-api';
import { StateManager } from './state-manager';
import { getOpenAPIApp } from './openapi-routes';

// Create main app
const app = new Hono<{ Bindings: Env }>();

// Add CORS middleware to allow API documentation UI to make requests
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length', 'X-Request-Id'],
  maxAge: 600,
  credentials: true,
}));

// Global config
let validatedConfig: any = null;

// Mount OpenAPI routes
const apiApp = getOpenAPIApp();
app.route('/', apiApp);

// Set up Scalar API Reference UI
app.get(
  '/ui',
  apiReference({
    theme: 'purple',
    spec: {
      url: '/openapi.json',
    },
  } as any)
);

// Redirect root to API documentation
app.get('/', (c) => c.redirect('/ui'));

// Cron trigger handler
async function handleScheduled(env: Env) {
  const logger = new Logger((env.LOG_LEVEL || 'debug') as any);
  
  try {
    // Validate environment on first run
    if (!validatedConfig) {
      try {
        validatedConfig = validateEnvironment(env, logger);
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
        headers: {
          'User-Agent': 'Site-Failover-Worker/1.0 (Cloudflare Workers) PDZRKZMkd2tnsg',
        },
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
              // Reset counters after successfully disabling redirect rule
              await stateManager.resetCounters();
              logger.info('Counters reset after disabling redirect rule');
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
              // Reset counters after successfully enabling redirect rule
              await stateManager.resetCounters();
              logger.info('Counters reset after enabling redirect rule');
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
