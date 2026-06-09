# azure-nl-search

Custom Node.js service that accepts plain-English queries and executes them
against Microsoft 365 via the Graph API. Claude handles NL → API translation;
the service handles auth, execution, and response formatting.

No MCP, no third-party AI platform wrappers — just your own code.

---

## How it works

```
Client (web / Slack / anything)
        │
        │  POST /search  { "query": "find emails to person@domain.com" }
        ▼
  [ Express server ]
        │
        ├─ 1. Claude translates NL → Graph API plan (endpoint, params, method)
        │
        ├─ 2. MSAL acquires Bearer token (client_credentials, cached)
        │
        ├─ 3. axios executes the Graph API call
        │
        └─ 4. Returns { plan, results } as JSON
```

---

## Setup

### 1. Azure AD app registration

1. Go to portal.azure.com → Azure Active Directory → App registrations → New registration
2. Name it `azure-nl-search`, select "Accounts in this org only"
3. Go to **Certificates & secrets** → New client secret → copy it immediately
4. Go to **API permissions** → Add → Microsoft Graph → Application permissions:
   - `Mail.Read.All`
   - `ChannelMessage.Read.All`
   - `Sites.Read.All`
   - `AuditLog.Read.All`
   - `Calendars.Read`
   - `User.Read.All`
   - `Files.Read.All`
5. Click **Grant admin consent**

### 2. Install and configure

```bash
npm install
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
```

### 3. Run

```bash
npm run dev    # development (nodemon)
npm start      # production
```

---

## API reference

### POST /search

Accepts a natural language query, returns Graph API plan + results.

```bash
curl -X POST http://localhost:3000/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-internal-key" \
  -d '{
    "query": "find all emails sent to john.doe@contoso.com in the last 7 days"
  }'
```

**Request body**

| Field      | Type    | Default | Description |
|------------|---------|---------|-------------|
| `query`    | string  | —       | Natural language query (required) |
| `planOnly` | boolean | false   | Return Graph plan without executing |
| `paginate` | boolean | false   | Follow @odata.nextLink to fetch all pages |
| `maxPages` | number  | 5       | Max pages when paginate=true |

**Response**

```json
{
  "ok": true,
  "query": "find all emails sent to john.doe@contoso.com in the last 7 days",
  "plan": {
    "intent": "Retrieve emails received by john.doe@contoso.com in the last 7 days",
    "service": "Exchange",
    "method": "GET",
    "full_url": "https://graph.microsoft.com/v1.0/users/john.doe@contoso.com/messages?$filter=receivedDateTime ge 2026-06-02T00:00:00Z&$select=subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime desc&$top=25",
    "scopes_needed": ["Mail.Read.All"]
  },
  "results": {
    "data": [ ... ],
    "count": 12,
    "nextLink": null,
    "service": "Exchange",
    "intent": "..."
  }
}
```

### GET /search/plan?q=...

Returns only the Graph API plan — no execution. Good for UI previews.

```bash
curl "http://localhost:3000/search/plan?q=show+failed+logins+for+sarah@contoso.com"
```

### GET /health

```bash
curl http://localhost:3000/health
# { "ok": true, "service": "azure-nl-search", "env": "development" }
```

### POST /slack/command

Slack slash command endpoint. Point your Slack app's slash command URL here.

**Usage in Slack:** `/msearch find Teams messages from last week mentioning Q3 budget`

---

## Example queries

| Query | Service hit |
|---|---|
| `find all emails to john@contoso.com last 7 days` | Exchange |
| `show Teams messages from Sarah mentioning budget this month` | Teams |
| `list SharePoint files modified by mark@contoso.com` | SharePoint |
| `find failed sign-in attempts for sarah@contoso.com` | Azure AD audit |
| `get calendar events with board meeting next week` | Calendar |
| `show files shared externally by the Marketing team` | OneDrive |

---

## Folder structure

```
azure-nl-search/
├── src/
│   ├── server.js              # Express entry point
│   ├── routes/
│   │   ├── search.js          # POST /search, GET /search/plan
│   │   └── slack.js           # POST /slack/command
│   ├── services/
│   │   ├── claude.js          # NL → Graph API plan (Anthropic SDK)
│   │   ├── graph.js           # Graph API executor (axios + MSAL)
│   │   ├── auth.js            # MSAL token acquisition + cache
│   │   └── logger.js          # Winston logger
│   └── middleware/
│       └── auth.js            # API key guard
├── config/
│   └── graph-scopes.js        # Scope reference + capability map
├── .env.example
├── package.json
└── README.md
```
