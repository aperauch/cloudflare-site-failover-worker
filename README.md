# Site Failover Worker

A Cloudflare Worker that monitors website health and automatically manages redirect rules for failover scenarios. Built with Hono framework and TypeScript.

## Quick Deploy

Deploy this Worker to your Cloudflare account with one click:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/aperauch/cloudflare-site-failover-worker)

The deploy button will:
- Clone the repository to your GitHub account
- Create a new Cloudflare Worker
- Provision the required Durable Object
- Set up the cron trigger for health checks
- Prompt you to configure environment variables and secrets

> **Note:** You'll need to complete the prerequisite setup below before the worker can function properly.

## Features

- **Automated Health Monitoring**: Checks target URL every minute via cron trigger
- **Intelligent Failover**: Enables redirect rule after consecutive failures
- **Automatic Recovery**: Disables redirect rule after consecutive successful health checks
- **Maintenance Mode**: Support for manual and scheduled maintenance windows
- **Persistent State**: Uses Cloudflare Durable Objects for state persistence across deployments
- **Comprehensive API**: RESTful endpoints for monitoring and management
- **Modern API Documentation**: Beautiful, interactive API docs powered by Scalar
- **Rate Limiting**: 60 requests per minute per IP address
- **Bearer Token Authentication**: Secure API access
- **Prometheus Metrics**: Export metrics for monitoring integration
- **Configurable Logging**: Debug, info, warn, and error log levels
- **Retry Logic**: Exponential backoff for Cloudflare API calls
- **Error Handling**: Graceful degradation and comprehensive error handling

## Table of Contents

- [Quick Deploy](#quick-deploy)
- [Features](#features)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Step 1: Create a Redirect Rule](#step-1-create-a-redirect-rule)
  - [Step 2: Create API Token](#step-2-create-api-token)
  - [Step 3: Get Your Cloudflare IDs](#step-3-get-your-cloudflare-ids)
  - [Step 4: Deploy the Worker](#step-4-deploy-the-worker)
  - [Step 5: Configure Secrets](#step-5-configure-secrets)
  - [Step 6: Verify Deployment](#step-6-verify-deployment)
- [Configuration](#configuration)
  - [Custom Domains (Optional)](#custom-domains-optional)
- [API Endpoints](#api-endpoints)
  - [Interactive Documentation](#interactive-documentation)
- [Development](#development)
- [How It Works](#how-it-works)
- [Monitoring & Observability](#monitoring--observability)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Disclaimer](#disclaimer)
- [License](#license)

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

## Getting Started

### Prerequisites

Before deploying the worker, you'll need:

1. **Cloudflare Account** with:
   - Active zone (domain)
   - Workers and Durable Objects enabled (Free plan works)
   - A website to monitor

2. **Cloudflare Redirect Rule** set up to redirect traffic to your failover site

3. **Cloudflare API Token** with permissions to manage redirect rules

4. **Local Development** (optional):
   - Node.js 18+
   - npm or yarn
   - Git

### Step 1: Create a Redirect Rule

First, create a redirect rule that will be toggled by this worker:

1. Go to **Cloudflare Dashboard** → Select your domain
2. Navigate to **Rules** → **Redirect Rules**
3. Click **Create rule**
4. Configure your failover redirect:
   - **Rule name**: `Failover to Backup Site`
   - **When incoming requests match**: 
     - Field: `Hostname`
     - Operator: `equals`
     - Value: `yourdomain.com`
   - **Then**: `Dynamic` redirect
   - **URL**: Your failover site URL (e.g., `https://backup.yourdomain.com`)
   - **Status code**: `302` (Temporary Redirect)
   - **Preserve query string**: Enabled (recommended)
5. Click **Save**
6. **Important**: Disable the rule immediately after creation (toggle off)
7. Copy the **Rule ID** from the URL or rule list

### Step 2: Create API Token

Create an API token with permissions to manage redirect rules:

1. Go to **Cloudflare Dashboard** → **My Profile** → **API Tokens**
2. Click **Create Token**
3. Select **Custom token** template
4. Configure permissions:
   - **Permissions**:
     - `Account` → `Account Rulesets` → `Edit`
   - **Account Resources**:
     - Include → Specific account → Select your account
   - **Zone Resources**:
     - Include → Specific zone → Select your domain
5. Click **Continue to summary** → **Create Token**
6. **Save this token securely** - you'll need it later

### Step 3: Get Your Cloudflare IDs

Collect the following IDs from your Cloudflare dashboard:

**Account ID:**
1. Go to **Cloudflare Dashboard**
2. Select any domain
3. Scroll down on the Overview page
4. Copy the **Account ID** from the right sidebar

**Zone ID:**
1. Go to **Cloudflare Dashboard** → Select your domain
2. Scroll down on the Overview page
3. Copy the **Zone ID** from the right sidebar

**Redirect Rule ID:**
- You copied this in Step 1 when creating the redirect rule
- Or find it at: **Rules** → **Redirect Rules** → Click your rule → Copy from URL

### Step 4: Deploy the Worker

**Option A: Deploy via Button (Recommended)**

1. Click the [Deploy to Cloudflare](#quick-deploy) button above
2. Authorize Cloudflare to access your GitHub account
3. Configure the deployment:
   - **Repository name**: Choose a name (default: `cloudflare-site-failover-worker`)
   - **Worker name**: Choose a name (default: `site-failover-worker`)
4. Configure environment variables when prompted:
   - `MONITOR_URL`: Your website URL to monitor (must be HTTPS)
   - `FAILURE_COUNT_THRESHOLD`: Number of consecutive failures before failover (e.g., `3`)
   - `RECOVERY_COUNT_THRESHOLD`: Number of consecutive successes before recovery (e.g., `2`)
   - `TIMEOUT_SECONDS`: Request timeout in seconds (e.g., `10`)
   - `REDIRECT_RULE_ID`: From Step 1
   - `ACCOUNT_ID`: From Step 3
   - `ZONE_ID`: From Step 3
   - `LOG_LEVEL`: `debug` or `info` (default: `debug`)
5. Configure secrets when prompted:
   - `CLOUDFLARE_API_TOKEN`: From Step 2
   - `API_TOKEN`: Generate a secure random token (e.g., using `openssl rand -hex 32`)
6. Click **Deploy**

**Option B: Manual Deployment**

1. Clone the repository:
```bash
git clone https://github.com/aperauch/cloudflare-site-failover-worker.git
cd cloudflare-site-failover-worker
```

2. Install dependencies:
```bash
npm install
```

3. Update `wrangler.jsonc` with your values:
```jsonc
{
  "vars": {
    "MONITOR_URL": "https://yourdomain.com",
    "FAILURE_COUNT_THRESHOLD": "3",
    "RECOVERY_COUNT_THRESHOLD": "2",
    "TIMEOUT_SECONDS": "10",
    "REDIRECT_RULE_ID": "your-redirect-rule-id",
    "ACCOUNT_ID": "your-account-id",
    "ZONE_ID": "your-zone-id",
    "LOG_LEVEL": "info"
  }
}
```

4. Deploy:
```bash
npm run deploy
```

### Step 5: Configure Secrets

Set the required secrets using Wrangler CLI:

```bash
# Set Cloudflare API Token (from Step 2)
wrangler secret put CLOUDFLARE_API_TOKEN
# Paste your token when prompted

# Set API Token for worker authentication
wrangler secret put API_TOKEN
# Generate and paste a secure token: openssl rand -hex 32
```

**Generate a secure API token:**
```bash
# On macOS/Linux:
openssl rand -hex 32

# Or use Node.js:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 6: Verify Deployment

1. **Check worker health:**
```bash
curl https://your-worker.your-subdomain.workers.dev/health
```

Expected response:
```json
{
  "status": "healthy",
  "durableObjectsAvailable": true,
  "lastCronExecution": "2024-01-15T10:30:00Z",
  "uptimeSeconds": 60
}
```

2. **Access interactive API documentation:**

Visit `https://your-worker.your-subdomain.workers.dev/ui` in your browser to access the modern Scalar API documentation interface. You can test all endpoints directly from the UI!

3. **Check monitoring status:**
```bash
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
  https://your-worker.your-subdomain.workers.dev/status
```

4. **View logs:**
```bash
wrangler tail
```

5. **Test failover** (optional):
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  https://your-worker.your-subdomain.workers.dev/simulate-failover
```

This will trigger the redirect rule to enable. Check your website to confirm the redirect works, then reset:
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  https://your-worker.your-subdomain.workers.dev/reset-counters
```

## Configuration

### Environment Variables

All environment variables must be configured in your `wrangler.jsonc` or via Cloudflare Dashboard:

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

### Custom Domains (Optional)

By default, your worker is accessible at `https://your-worker-name.your-subdomain.workers.dev`. You can optionally add a custom domain for a more professional URL.

#### Option 1: Cloudflare Dashboard (Recommended)

The easiest way to add a custom domain:

1. Go to **Cloudflare Dashboard** → **Workers & Pages**
2. Click on your worker name
3. Go to **Triggers** tab
4. Scroll to **Custom Domains** section
5. Click **Add Custom Domain**
6. Enter your domain (e.g., `monitor.yourdomain.com`)
7. Click **Add Custom Domain**

Cloudflare will automatically:
- Create the necessary DNS records
- Provision SSL certificates
- Route traffic to your worker

**Requirements:**
- Domain must be active in your Cloudflare account
- DNS must be proxied through Cloudflare (orange cloud ☁️)

#### Option 2: Wrangler Configuration

Add custom domains via `wrangler.jsonc`:

1. **Edit `wrangler.jsonc`** and uncomment the routes section:

```jsonc
{
  "routes": [
    {
      "pattern": "monitor.yourdomain.com/*",
      "zone_name": "yourdomain.com"
    }
  ]
}
```

2. **Deploy the worker:**

```bash
npm run deploy
```

**Multiple routes example:**

```jsonc
{
  "routes": [
    {
      "pattern": "monitor.yourdomain.com/*",
      "zone_name": "yourdomain.com"
    },
    {
      "pattern": "api.yourdomain.com/health/*",
      "zone_name": "yourdomain.com"
    }
  ]
}
```

#### Option 3: Wrangler CLI

Deploy with routes directly via command line:

```bash
wrangler deploy --route "monitor.yourdomain.com/*" --route "yourdomain.com/api/*"
```

#### Verify Custom Domain

After configuring your custom domain:

```bash
# Test with custom domain
curl https://monitor.yourdomain.com/health

# Original workers.dev URL still works
curl https://your-worker.your-subdomain.workers.dev/health
```

> **Note:** Both URLs remain active unless you explicitly disable the `workers.dev` route in the Cloudflare Dashboard.

## API Endpoints

### Interactive Documentation

The worker includes a beautiful, modern API documentation interface powered by [Scalar](https://scalar.com/).

**Access the interactive docs:**
- **Production**: `https://your-worker.your-subdomain.workers.dev/ui`
- **Custom Domain**: `https://your-custom-domain.com/ui` (if configured)
- **Local Development**: `http://localhost:8787/ui`

The Scalar UI provides:
- ✨ Beautiful, modern interface with dark mode
- 🔍 Advanced search functionality (press `k` for hotkey)
- 💻 Auto-generated code examples in multiple languages (cURL, JavaScript, Python, etc.)
- 🧪 Built-in API testing with authentication support
- 📱 Fully responsive design
- 📖 Complete endpoint documentation with request/response schemas

> **Tip:** Use the interactive UI to test endpoints directly in your browser!

### Authentication

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

## Development

### Local Development Setup

For local development and testing:

1. **Clone and install:**
```bash
git clone https://github.com/aperauch/cloudflare-site-failover-worker.git
cd cloudflare-site-failover-worker
npm install
```

2. **Create local environment file:**
```bash
cp .env.example .env
# Edit .env with your local development values
```

3. **Generate TypeScript types:**
```bash
npm run cf-typegen
```

4. **Start development server:**
```bash
npm run dev
```

This starts a local server with hot reload at `http://localhost:8787`.

**Access the interactive API documentation** at `http://localhost:8787/ui` to explore and test all endpoints!

### Available Scripts

- `npm run dev` - Start local development server
- `npm run deploy` - Deploy to Cloudflare (with minification)
- `npm run cf-typegen` - Generate TypeScript types for bindings

### Testing Locally

**Option 1: Use the Interactive UI (Recommended)**

Visit `http://localhost:8787/ui` and test all endpoints directly from the Scalar interface with built-in authentication and request builders!

**Option 2: Use cURL**

Test endpoints via command line:

```bash
# Health check (no auth required)
curl http://localhost:8787/health

# Status (requires auth)
curl -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:8787/status

# Simulate failover
curl -X POST -H "Authorization: Bearer YOUR_API_TOKEN" \
  http://localhost:8787/simulate-failover
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

## Disclaimer

**IMPORTANT: READ CAREFULLY BEFORE USING THIS SOFTWARE**

This software is provided as-is for monitoring and failover management purposes. By using this software, you acknowledge and agree to the following:

### No Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### Limitation of Liability

**The authors and contributors of this software shall not be held liable for:**

- Any website downtime, outages, or service interruptions
- Failed health checks or missed failover events
- Data loss or corruption
- Business losses or lost revenue
- Damages resulting from the use or inability to use this software
- Any errors, bugs, or issues in the software
- Incorrect redirect rule management
- API failures or rate limiting issues
- Any other direct, indirect, incidental, special, exemplary, or consequential damages

### User Responsibility

**By deploying and using this software, you agree that:**

- You are solely responsible for testing and validating the software in your environment
- You are responsible for monitoring the worker's operation and performance
- You should implement redundant monitoring and alerting systems
- You understand that automated failover systems may not be 100% reliable
- You will not hold the authors liable for any issues arising from the use of this software
- It is your responsibility to ensure business continuity and disaster recovery plans
- You should thoroughly test all failover scenarios before relying on this software in production

### Recommendation

This software should be used as **one component** of a comprehensive monitoring and failover strategy. Do not rely solely on this worker for critical business operations. Always implement multiple layers of monitoring, alerting, and failover mechanisms.

### Support

This is open-source software provided free of charge with no guarantees or warranties. Support is provided on a best-effort basis through GitHub Issues. The authors are under no obligation to provide support, maintenance, or updates.

## License

MIT License

Copyright (c) 2025 Aron Perauch

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

See [LICENSE](./LICENSE) file for full details
