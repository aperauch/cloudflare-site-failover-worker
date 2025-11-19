import type { Env, ValidatedConfig, LogLevel } from './types';
import { Logger } from './logger';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateEnvironment(env: Env, logger: Logger): ValidatedConfig {
  const errors: string[] = [];

  // Validate MONITOR_URL
  if (!env.MONITOR_URL) {
    errors.push('MONITOR_URL is required');
  } else {
    try {
      const url = new URL(env.MONITOR_URL);
      if (url.protocol !== 'https:') {
        errors.push('MONITOR_URL must be an HTTPS URL');
      }
    } catch {
      errors.push('MONITOR_URL must be a valid URL');
    }
  }

  // Validate FAILURE_COUNT_THRESHOLD
  const failureCountThreshold = parseInt(env.FAILURE_COUNT_THRESHOLD, 10);
  if (!env.FAILURE_COUNT_THRESHOLD || isNaN(failureCountThreshold) || failureCountThreshold <= 0) {
    errors.push('FAILURE_COUNT_THRESHOLD must be a positive integer');
  }

  // Validate RECOVERY_COUNT_THRESHOLD
  const recoveryCountThreshold = parseInt(env.RECOVERY_COUNT_THRESHOLD, 10);
  if (!env.RECOVERY_COUNT_THRESHOLD || isNaN(recoveryCountThreshold) || recoveryCountThreshold <= 0) {
    errors.push('RECOVERY_COUNT_THRESHOLD must be a positive integer');
  }

  // Validate TIMEOUT_SECONDS
  const timeoutSeconds = parseInt(env.TIMEOUT_SECONDS, 10);
  if (!env.TIMEOUT_SECONDS || isNaN(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 30) {
    errors.push('TIMEOUT_SECONDS must be between 1 and 30');
  }

  // Validate REDIRECT_RULE_ID
  if (!env.REDIRECT_RULE_ID) {
    errors.push('REDIRECT_RULE_ID is required');
  }

  // Validate ACCOUNT_ID
  if (!env.ACCOUNT_ID) {
    errors.push('ACCOUNT_ID is required');
  }

  // Validate ZONE_ID
  if (!env.ZONE_ID) {
    errors.push('ZONE_ID is required');
  }

  // Validate CLOUDFLARE_API_TOKEN
  if (!env.CLOUDFLARE_API_TOKEN) {
    errors.push('CLOUDFLARE_API_TOKEN is required');
  }

  // Validate API_TOKEN
  if (!env.API_TOKEN) {
    errors.push('API_TOKEN is required');
  }

  // Validate LOG_LEVEL
  const logLevel = (env.LOG_LEVEL || 'debug').toLowerCase() as LogLevel;
  const validLogLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  if (!validLogLevels.includes(logLevel)) {
    errors.push('LOG_LEVEL must be one of: debug, info, warn, error');
  }

  if (errors.length > 0) {
    const errorMessage = 'Environment validation failed:\n' + errors.map(e => `  - ${e}`).join('\n');
    logger.error(errorMessage);
    throw new ValidationError(errorMessage);
  }

  return {
    monitorUrl: env.MONITOR_URL,
    failureCountThreshold,
    recoveryCountThreshold,
    timeoutSeconds,
    redirectRuleId: env.REDIRECT_RULE_ID,
    accountId: env.ACCOUNT_ID,
    zoneId: env.ZONE_ID,
    cloudflareApiToken: env.CLOUDFLARE_API_TOKEN,
    logLevel,
    apiToken: env.API_TOKEN,
  };
}
