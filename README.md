# azure-nl-search

Natural language search and compliance tooling for Microsoft 365, powered by Claude and deployed on Railway.

IT and Security teams describe what they're looking for in plain English — the service translates that into either a **Microsoft Purview KQL query** (for eDiscovery / PST export) or a live **Microsoft Graph API** call. A web dashboard provides a guided interface; a Slack slash command is also available for ad-hoc lookups.

---

## How it works

```
Browser / Slack
      │
      │  "find emails to john@contoso.com about wire transfers last 30 days"
      ▼
┌─────────────────────────────────────────────────────────────┐
│                  Express server (Railway)                    │
│                                                             │
│  POST /compliance                  POST /search             │
│       │                                 │                   │
│       ▼                                 ▼                   │
│  Claude (KQL)               Claude (Graph API plan)         │
│       │                                 │                   │
│       ▼                                 ▼                   │
│  Returns KQL + Purview      MSAL token → Graph API call     │
│  steps + locations          → returns live data             │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
Dashboard renders KQL with "Open in Purview" button
IT pastes KQL → runs Content Search → exports PST
```

### Two modes

**Compliance mode** (`POST /compliance`) — no data is accessed. Claude generates a Purview-ready KQL query, the exact content locations to include, and step-by-step instructions for running the search in Microsoft Purview Compliance Center. IT clicks through to Purview and exports the PST from there.

**Search mode** (`POST /search`) — executes live Graph API calls against your Microsoft 365 tenant. Requires Azure AD application permissions. Used for real-time lookups rather than legal/compliance exports.

---

## Authentication

### Web dashboard — Microsoft SSO

The dashboard is protected by Microsoft Single Sign-On via Azure AD. Unauthenticated requests redirect to the Microsoft login page; only users in your Azure AD tenant can sign in. After login a signed JWT cookie is issued (8-hour session). No username/password is stored by this service.

```
User → /auth/login → Microsoft login → /auth/callback → JWT cookie → dashboard
```

### API routes — JWT cookie (SSO)

All `/compliance` and `/search` endpoints require the same JWT cookie set by SSO. Direct API calls (e.g. from scripts) must supply the cookie or use the `API_SECRET_KEY` header guard as a fallback.

### Slack — response_url pattern

The Slack slash command uses its own payload verification. No SSO cookie is required.

---

## Setup

### 1. Azure AD app registration

One app registration covers both SSO (user login) and Graph API access (application permissions).

1. Go to `portal.azure.com → Azure Active Directory → App registrations → New registration`
2. Name: `azure-nl-search` · Supported account types: **This org only**
3. **Certificates & secrets** → New client secret → copy the value immediately
4. **Authentication → Add platform → Web**
   - Redirect URI: `https://your-railway-url.up.railway.app/auth/callback`
   - Check **ID tokens** and **Access tokens** under Implicit grant
5. **API permissions → Add → Microsoft Graph → Application permissions:**
   - `Mail.Read.All`
   - `ChannelMessage.Read.All`
   - `Sites.Read.All`
   - `AuditLog.Read.All`
   - `Calendars.Read`
   - `User.Read.All`
   - `Files.Read.All`
   - Click **Grant admin consent**

> The `openid`, `profile`, `email`, and `User.Read` delegated permissions used for SSO login are added automatically.

### 2. Environment variables

Copy `.env.example` to `.env` and fill in all values.

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key — powers NL translation |
| `AZURE_TENANT_ID` | Yes | Azure AD tenant ID (from app registration overview) |
| `AZURE_CLIENT_ID` | Yes | Application (client) ID |
| `AZURE_CLIENT_SECRET` | Yes | Client secret value (not the secret ID) |
| `AZURE_REDIRECT_URI` | Yes | Full callback URL — must match Azure AD exactly |
| `JWT_SECRET` | Yes | Random 32+ char secret for signing session cookies |
| `NODE_ENV` | Yes | `production` on Railway |
| `PORT` | No | Auto-set by Railway — do not override |
| `API_SECRET_KEY` | No | Optional secondary key guard for non-browser API callers |

Generate `JWT_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Railway deployment

Railway auto-detects Node.js and runs `npm start`. No additional config files needed.

1. Create a new Railway project
2. New Service → Deploy from GitHub repo
3. Add the environment variables above under Variables
4. Railway deploys on every push to `main`

Verify the deployment:
```bash
curl https://your-app.up.railway.app/health
```

### 4. Local development

```bash
npm install
cp .env.example .env   # fill in all values
npm run dev            # nodemon restarts on file changes
```

For SSO to work locally, add `http://localhost:3000/auth/callback` as a redirect URI in Azure AD (in addition to the production URL).

---

## API reference

All endpoints except `/health` and `/auth/*` require an authenticated session (JWT cookie from SSO).

### GET /health

Returns service status and registered routes. No authentication required.

```bash
curl https://your-app.up.railway.app/health
```

---

### POST /compliance ⭐ Primary endpoint

Translates a natural language query into a Microsoft Purview KQL query. No Microsoft 365 data is accessed — this is a pure NL → KQL translation. The IT team pastes the output into Purview Content Search and exports from there.

**Request body:**

| Field | Type | Description |
|---|---|---|
| `query` | string | Freeform natural language query (overrides all other fields) |
| `scope` | string | `All` \| `Email` \| `Teams` \| `SharePoint` \| `OneDrive` |
| `user` | string | Target mailbox UPN, e.g. `john@contoso.com` |
| `dateFrom` | string | ISO date, e.g. `2026-05-01` |
| `dateTo` | string | ISO date, e.g. `2026-06-09` |
| `keywords` | string | Additional keywords or subject terms |

**Example:**
```bash
curl -X POST https://your-app.up.railway.app/compliance \
  -H "Content-Type: application/json" \
  -b "csa_session=<your-jwt-cookie>" \
  -d '{"query": "find all emails sent to john@contoso.com about wire transfers in the last 30 days"}'
```

**Response:**
```json
{
  "ok": true,
  "plan": {
    "intent": "Find emails received by john@contoso.com mentioning wire transfers in the last 30 days",
    "kql": "to:john@contoso.com AND subject:\"wire transfer\" AND received:2026-05-10..2026-06-09",
    "content_types": ["Email"],
    "locations": {
      "mailboxes": ["john@contoso.com"],
      "sites": [],
      "teams": [],
      "all_mailboxes": false,
      "all_sites": false
    },
    "purview_steps": [
      "In Purview, go to Content search → New search",
      "Paste the KQL into the Keywords box",
      "Under Locations, select Specific locations and add the mailbox listed",
      "Run the search, review results, then export as PST"
    ],
    "notes": "Requires eDiscovery Manager role or higher"
  }
}
```

### GET /compliance/build?q=...

Quick GET version for simple NL queries — useful for testing in a browser tab.

```bash
curl "https://your-app.up.railway.app/compliance/build?q=emails+from+CFO+last+30+days"
```

---

### POST /search

Executes a live Microsoft Graph API call against your M365 tenant. Requires Azure AD application permissions to be granted (see setup step 5). Returns actual data — use with caution in production.

| Field | Type | Default | Description |
|---|---|---|---|
| `query` | string | — | Natural language query (required) |
| `planOnly` | boolean | false | Return Graph API plan without executing |
| `paginate` | boolean | false | Follow `@odata.nextLink` to fetch all pages |
| `maxPages` | number | 5 | Safety cap when `paginate` is true |

### GET /search/plan?q=...

Returns the translated Graph API plan for a query without executing it.

---

### GET /auth/login

Redirects the user to Microsoft login. Entry point for SSO.

### GET /auth/callback

OAuth 2.0 callback handler. Exchanges the auth code for tokens, issues a JWT session cookie, and redirects to the dashboard. Do not call directly.

### GET /auth/logout

Clears the session cookie and redirects to Microsoft's logout endpoint.

### GET /api/me

Returns the currently logged-in user's name and email from the session cookie. Used by the dashboard to populate the topbar.

---

### POST /slack/command

Slack slash command handler. Configure your Slack app's slash command Request URL to point here.

**Usage in Slack:**
```
/msearch find all emails to john@contoso.com about wire transfers
```

Acknowledges immediately (to avoid Slack's 3-second timeout) and posts results back via `response_url`.

---

## Web dashboard

Served at the root URL (`/`) — requires SSO login.

**Features:**
- Content scope selector: All / Email / Teams / SharePoint / OneDrive
- Guided fields: user/mailbox, date range, keywords
- Freeform natural language input
- Generated KQL output with one-click copy
- Content locations panel showing which mailboxes/sites to add in Purview
- Step-by-step Purview instructions
- Direct link to Microsoft Purview Compliance Center
- Saved searches (persisted in browser localStorage per user)
- Signed-in user displayed in topbar with sign-out button

---

## Example queries

| Natural language | Service | KQL output |
|---|---|---|
| `find emails to john@contoso.com last 7 days` | Exchange | `to:john@contoso.com AND received:2026-06-02..2026-06-09` |
| `emails from CFO mentioning wire transfer` | Exchange | `from:cfo@contoso.com AND "wire transfer"` |
| `Teams messages about Q3 budget this month` | Teams | `kind:im AND "Q3 budget" AND sent:2026-06-01..2026-06-09` |
| `SharePoint files modified by mark last 30 days` | SharePoint | `site:https://contoso.sharepoint.com AND author:mark` |
| `failed sign-in attempts for sarah@contoso.com` | Azure AD | Routed to `/search` → `auditLogs/signIns` with filter |
| `all external email from Finance team` | Exchange | `from:finance@contoso.com AND recipients:*` |

---

## Project structure

```
azure-nl-search/
├── public/
│   └── index.html              Web dashboard (served at /)
│
├── src/
│   ├── server.js               Express entry point — middleware, routes, static serving
│   │
│   ├── routes/
│   │   ├── auth.js             SSO: /auth/login, /auth/callback, /auth/logout, /api/me
│   │   ├── compliance.js       POST /compliance and GET /compliance/build
│   │   ├── search.js           POST /search and GET /search/plan
│   │   └── slack.js            POST /slack/command
│   │
│   ├── services/
│   │   ├── kql.js              Claude → Purview KQL plan generator
│   │   ├── claude.js           Claude → Microsoft Graph API plan generator
│   │   ├── graph.js            Graph API executor with pagination + error handling
│   │   ├── msAuth.js           MSAL auth code flow for SSO (user login)
│   │   ├── auth.js             MSAL client credentials flow for Graph API (app-only)
│   │   └── logger.js           Winston logger
│   │
│   └── middleware/
│       ├── requireAuth.js      JWT cookie guard — redirects pages, 401s API routes
│       └── auth.js             Legacy API key guard (optional fallback)
│
├── config/
│   └── graph-scopes.js         Graph API permission scope reference
│
├── .env.example                All required environment variables with descriptions
├── package.json
└── README.md
```

---

## Security notes

- SSO restricts access to your Azure AD tenant — no external users can log in
- JWT cookies are `httpOnly`, `secure` (production), and `sameSite: lax`
- Sessions expire after 8 hours
- The `/compliance` endpoint never accesses or returns Microsoft 365 data — it only generates KQL
- The `/search` endpoint requires explicit Azure AD application permissions with admin consent
- Rate limiting is applied globally: 60 requests per minute per IP
