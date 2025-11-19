import { Logger } from './logger';

export interface RedirectRuleInfo {
  id: string;
  enabled: boolean;
  status: string;
  lastModified: string;
}

export class CloudflareAPIClient {
  private apiToken: string;
  private logger: Logger;
  private zoneId: string;
  private accountId: string;

  constructor(apiToken: string, zoneId: string, accountId: string, logger: Logger) {
    this.apiToken = apiToken;
    this.zoneId = zoneId;
    this.accountId = accountId;
    this.logger = logger;
  }

  async getRedirectRule(ruleId: string): Promise<RedirectRuleInfo | null> {
    try {
      this.logger.debug(`Fetching redirect rule ${ruleId}`);
      
      // Use Cloudflare API to get the ruleset containing the rule
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/rulesets/${ruleId}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: any = await response.json();
      
      // The ruleset contains an array of rules - we need to check the first rule's enabled status
      if (!data.result?.rules || data.result.rules.length === 0) {
        this.logger.warn('No rules found in ruleset');
        return null;
      }
      
      const rule = data.result.rules[0];
      
      return {
        id: rule.id,
        enabled: rule.enabled === true,
        status: rule.enabled ? 'active' : 'inactive',
        lastModified: rule.last_updated || new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('Failed to fetch redirect rule', { error: error.message });
      return null;
    }
  }

  async updateRedirectRule(ruleId: string, enabled: boolean): Promise<boolean> {
    let lastError: any = null;
    
    // Retry logic: up to 3 times with exponential backoff
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        this.logger.info(`Attempting to ${enabled ? 'enable' : 'disable'} redirect rule (attempt ${attempt}/3)`);
        
        // Get the current ruleset first
        const getRulesetResponse = await fetch(
          `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/rulesets/${ruleId}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${this.apiToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!getRulesetResponse.ok) {
          const status = getRulesetResponse.status;
          if (status === 401 || status === 403) {
            this.logger.error('Critical: Cloudflare API authentication failed. Disabling further API calls.', {
              status,
            });
            throw new Error('AUTHENTICATION_FAILED');
          }
          throw new Error(`HTTP ${status}: ${getRulesetResponse.statusText}`);
        }

        const rulesetData: any = await getRulesetResponse.json();
        
        // Update the ruleset with modified rules
        const updateResponse = await fetch(
          `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/rulesets/${ruleId}`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${this.apiToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              rules: rulesetData.result.rules.map((rule: any) => ({
                ...rule,
                enabled,
              })),
            }),
          }
        );

        if (!updateResponse.ok) {
          const status = updateResponse.status;
          if (status === 401 || status === 403) {
            this.logger.error('Critical: Cloudflare API authentication failed. Disabling further API calls.', {
              status,
            });
            throw new Error('AUTHENTICATION_FAILED');
          }
          throw new Error(`HTTP ${status}: ${updateResponse.statusText}`);
        }

        this.logger.info(`Successfully ${enabled ? 'enabled' : 'disabled'} redirect rule`);
        return true;
      } catch (error: any) {
        lastError = error;
        
        if (error.message === 'AUTHENTICATION_FAILED') {
          throw error;
        }

        this.logger.warn(`Failed to update redirect rule (attempt ${attempt}/3)`, {
          message: error.message,
        });

        if (attempt < 3) {
          const backoffMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
          this.logger.debug(`Retrying in ${backoffMs}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    this.logger.error('All retries exhausted. Failed to update redirect rule.', {
      lastError: lastError?.message,
    });
    return false;
  }
}
