# Site Failover Worker

A Cloudflare Worker that monitors website health and automatically manages redirect rules for failover scenarios. Built with Hono framework and TypeScript.

## Features

- **Automated Health Monitoring**: Checks target URL every minute via cron trigger
- **Intelligent Failover**: Enables redirect rule after consecutive failures
- **Automatic Recovery**: Disables redirect rule after consecutive successful health checks
- **Maintenance Mode**: Support for manual and scheduled maintenance windows
- **Persistent State**: Uses Cloudflare Durable Objects for state persistence across deployments
- **Comprehensive API**: RESTful endpoints for monitoring and management
- **Rate Limiting**: 60 requests per minute per IP address
- **Bearer Token Authentication**: Secure API access
- **Prometheus Metrics**: Export metrics for monitoring integration
- **Configurable Logging**: Debug, info, warn, and error log levels
- **Retry Logic**: Exponential backoff for Cloudflare API calls
- **Error Handling**: Graceful degradation and comprehensive error handling

## Architecture

```
┌─────────────────┐
│  Cron Trigger   │ (Every 1 minute)
│  (Scheduled)    │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│   Health Check Monitor      │
│  - Fetch MONITOR_URL        │
│  - Update counters          │
│  - Check thresholds         │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│   Durable Object            │
│  - Failure/Recovery counters│
│  - Maintenance state        │
│  - History tracking         │
│  - Metrics storage          │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│   Cloudflare API            │
│  - Update Redirect Rules    │
│  - Retry with backoff       │
└─────────────────────────────┘
```

## Environment Variables

All environment variables must be configured in your `wrangler.toml` or via Cloudflare Dashboard:

| Variable | Required | Description |
|----------|----------|-------------|
| `MONITOR_URL` | Yes | HTTPS URL to monitor |
| `FAILURE_COUNT_THRESHOLD` | Yes | Consecutive failures before enabling redirect |
| `RECOVERY_COUNT_THRESHOLD` | Yes | Consecutive successes before disabling redirect |
| `TIMEOUT_SECONDS` | Yes | Request timeout (1-30 seconds) |
| `REDIRECT_RULE_ID` | Yes | Cloudflare Redirect Rule ID |
| `ACCOUNT_ID` | Yes | Cloudflare Account ID |
| `ZONE_ID` | Yes | Cloudflare Zone ID |
| `CLOUDFLARE_API_TOKEN` | Yes | Cloudflare API token with redirect rule permissions |
| `API_TOKEN` | Yes | Bearer token for API authentication |
| `LOG_LEVEL` | No | Logging level: debug, info, warn, error (default: debug) |

### Example Configuration

```toml
# wrangler.toml
[env.production]
vars = { LOG_LEVEL = "info" }

[env.production.vars]
MONITOR_URL = "https://example.com"
FAILURE_COUNT_THRESHOLD = "3"
RECOVERY_COUNT_THRESHOLD = "2"
TIMEOUT_SECONDS = "10"
REDIRECT_RULE_ID = "your-rule-id"
ACCOUNT_ID = "your-account-id"
ZONE_ID = "your-zone-id"

# Use wrangler secret for sensitive values:
# wrangler secret put CLOUDFLARE_API_TOKEN
# wrangler secret put API_TOKEN
```

## API Endpoints

All endpoints (except `/health`) require Bearer token authentication:

```bash
Authorization: Bearer YOUR_API_TOKEN
```

### Status & Monitoring

#### `GET /health`
Returns worker operational health (no authentication required).

**Response:**
```json
{
  "status": "healthy",
  "durableObjectsAvailable": true,
  "lastCronExecution": "2024-01-15T10:30:00Z",
  "uptimeSeconds": 3600
}
```

#### `GET /status`
Returns current monitoring status.

**Response:**
```json
{
  "monitorUrl": "https://example.com",
  "failureCount": 0,
  "recoveryCount": 5,
  "lastCheckTime": "2024-01-15T10:30:00Z",
  "nextCheckTime": "2024-01-15T10:31:00Z",
  "redirectRuleEnabled": false,
  "maintenanceMode": false,
  "scheduledMaintenanceWindows": [],
  "thresholds": {
    "failureCountThreshold": 3,
    "recoveryCountThreshold": 2,
    "timeoutSeconds": 10
  }
}
```

#### `GET /metrics`
Returns Prometheus-format metrics.

**Response:**
```
# HELP health_checks_total Total number of health checks performed
# TYPE health_checks_total counter
health_checks_total 1234

# HELP failures_total Total number of failures detected
# TYPE failures_total counter
failures_total 56
```

### Redirect Rule Management

#### `GET /redirect-rule`
Returns current redirect rule state from Cloudflare API.

**Response:**
```json
{
  "id": "rule-id",
  "status": "active",
  "lastModified": "2024-01-15T10:00:00Z",
  "lastChecked": "2024-01-15T10:30:00Z"
}
```

#### `GET /redirect-rule-history`
Returns last 50 redirect rule state changes.

**Response:**
```json
{
  "history": [
    {
      "timestamp": "2024-01-15T10:00:00Z",
      "event": "enabled",
      "reason": "Failure threshold reached (3 consecutive failures)",
      "failureCount": 3,
      "recoveryCount": 0
    }
  ]
}
```

### Testing & Management

#### `POST /simulate-failover`
Forces failure counter to threshold for testing.

**Response:**
```json
{
  "success": true,
  "newFailureCount": 3,
  "message": "Failure counter set to 3"
}
```

#### `POST /simulate-recovery`
Forces recovery counter to threshold for testing.

**Response:**
```json
{
  "success": true,
  "newRecoveryCount": 2,
  "message": "Recovery counter set to 2"
}
```

#### `POST /reset-counters`
Resets failure and recovery counters to 0.

**Response:**
```json
{
  "success": true,
  "message": "Counters reset successfully"
}
```

### Maintenance Mode

#### `POST /maintenance-mode`
Enable or disable maintenance mode.

**Request:**
```json
{
  "enabled": true,
  "reason": "Scheduled database migration"
}
```

**Response:**
```json
{
  "success": true,
  "maintenanceMode": true,
  "message": "Maintenance mode enabled"
}
```

#### `POST /maintenance-window`
Schedule a maintenance window.

**Request:**
```json
{
  "startTime": "2024-01-15T22:00:00Z",
  "endTime": "2024-01-15T23:00:00Z",
  "reason": "Server maintenance"
}
```

**Response:**
```json
{
  "success": true,
  "windowId": "uuid",
  "startTime": "2024-01-15T22:00:00Z",
  "endTime": "2024-01-15T23:00:00Z",
  "message": "Maintenance window scheduled"
}
```

#### `GET /maintenance-windows`
Returns all scheduled maintenance windows.

**Response:**
```json
{
  "windows": [
    {
      "id": "uuid",
      "startTime": "2024-01-15T22:00:00Z",
      "endTime": "2024-01-15T23:00:00Z",
      "reason": "Server maintenance",
      "isActive": false
    }
  ]
}
```

#### `DELETE /maintenance-window/:windowId`
Cancels a scheduled maintenance window.

**Response:**
```json
{
  "success": true,
  "message": "Maintenance window cancelled"
}
```

## Quick Deploy

Deploy this Worker to your Cloudflare account with one click:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_USERNAME/site-failover-worker)

> **Note:** Replace `YOUR_USERNAME` with your GitHub username before sharing this button. After deployment, you'll need to configure the required environment variables and secrets.

## Development

### Prerequisites

- Node.js 18+
- npm or yarn
- Cloudflare account with Workers and Durable Objects enabled

### Installation

```bash
npm install
```

### Local Development

```bash
npm run dev
```

This starts a local development server with hot reload.

### Type Generation

Generate TypeScript types for Cloudflare bindings:

```bash
npm run cf-typegen
```

### Deployment

```bash
npm run deploy
```

This deploys the worker to Cloudflare with minification enabled.

### Setting Secrets

Use Wrangler CLI to set sensitive environment variables:

```bash
wrangler secret put CLOUDFLARE_API_TOKEN
wrangler secret put API_TOKEN
```

## How It Works

### Health Check Cycle

1. **Every 1 minute**: Cron trigger executes health check
2. **Success (HTTP 200)**: 
   - Increment recovery counter
   - Reset failure counter
   - If recovery threshold reached AND redirect rule is enabled: Disable redirect rule
3. **Failure (non-200 or timeout)**:
   - Increment failure counter
   - Reset recovery counter
   - If failure threshold reached AND redirect rule is disabled: Enable redirect rule

### Maintenance Mode

During maintenance mode or scheduled maintenance windows:
- Health checks continue to run
- Counters are updated normally
- **No changes are made to redirect rules**
- Actions that would be taken are logged

### State Persistence

All state is stored in Cloudflare Durable Objects:
- Failure and recovery counters
- Redirect rule state
- Maintenance mode settings
- Scheduled maintenance windows
- Historical changes (last 50 entries)
- Metrics and statistics

State persists across:
- Worker deployments
- Worker updates
- Cloudflare infrastructure changes

### Error Handling

- **Health check failures**: Logged and counted as failures
- **Cloudflare API errors**: 
  - Automatic retry with exponential backoff (1s, 2s, 4s)
  - After 3 failed attempts, log error and continue monitoring
- **Authentication failures (401/403)**: 
  - Log critical error
  - Disable further API calls until next deployment
- **Durable Object unavailable**: 
  - Return 503 on API requests
  - Health endpoint reports degraded status

## Monitoring & Observability

### Cloudflare Workers Logs

All logs are sent to Cloudflare Workers Logs with structured data:
- Health check results
- Counter updates
- API actions and errors
- Maintenance mode changes

Access logs via:
- Cloudflare Dashboard → Workers & Pages → Your Worker → Logs
- Logpush to external services
- Real-time tail: `wrangler tail`

### Prometheus Metrics

Export metrics to Prometheus via `/metrics` endpoint:
- `health_checks_total`: Total health checks performed
- `failures_total`: Total failures detected
- `redirect_rule_changes_total`: Total rule state changes
- `api_errors_total`: Total API errors encountered

## Security

- **Bearer Token Authentication**: All management endpoints require valid API token
- **Rate Limiting**: 60 requests per minute per IP address
- **Secret Management**: Sensitive tokens stored as Cloudflare secrets
- **HTTPS Only**: Monitor URL must be HTTPS
- **Input Validation**: All inputs validated before processing

## Troubleshooting

### Worker not starting
- Check environment variable validation in logs
- Ensure all required variables are set
- Verify MONITOR_URL is valid HTTPS URL
- Confirm threshold values are positive integers

### Health checks not running
- Verify cron trigger is configured in `wrangler.jsonc`
- Check `/health` endpoint for last cron execution time
- Review worker logs for errors

### Redirect rule not updating
- Verify CLOUDFLARE_API_TOKEN has correct permissions
- Check for authentication errors in logs
- Confirm REDIRECT_RULE_ID, ZONE_ID, and ACCOUNT_ID are correct
- Review `/redirect-rule-history` for change history

### Maintenance mode not working
- Check `/status` for current maintenance mode state
- Verify scheduled maintenance window times are correct (ISO8601 format)
- Review logs for maintenance mode actions

## License

MIT
