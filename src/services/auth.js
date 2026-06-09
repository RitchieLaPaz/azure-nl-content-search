/**
 * services/auth.js — MSAL client credentials flow for Graph API access
 *
 * Acquires and caches an app-only Bearer token for Microsoft Graph API calls.
 * Uses the OAuth 2.0 client credentials grant (no user context) — appropriate
 * for server-to-server calls like POST /search which execute live Graph queries.
 *
 * This is separate from services/msAuth.js which handles interactive user
 * login (SSO) for the web dashboard.
 *
 * The token is cached in memory and refreshed automatically ~60 seconds before
 * expiry, so most requests reuse a cached token with no network overhead.
 *
 * Required env vars: AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID
 * Required Azure AD permissions: application permissions with admin consent
 *   (Mail.Read.All, Sites.Read.All, AuditLog.Read.All, etc.)
 */
const msal   = require('@azure/msal-node');
const logger = require('./logger');

let _clientApp  = null;
let _tokenCache = { token: null, expiresAt: 0 };

function getClientApp() {
  if (!_clientApp) {
    _clientApp = new msal.ConfidentialClientApplication({
      auth: {
        clientId:     process.env.AZURE_CLIENT_ID,
        authority:    `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
      },
      system: {
        loggerOptions: {
          loggerCallback: (level, message) => {
            if (level === msal.LogLevel.Error) logger.error('[MSAL]', message);
          },
          piiLoggingEnabled: false,
          logLevel: msal.LogLevel.Error,
        },
      },
    });
  }
  return _clientApp;
}

/**
 * Returns a valid Bearer token for Microsoft Graph.
 * Serves from in-memory cache when possible; refreshes 60s before expiry.
 */
async function getAccessToken() {
  const now       = Date.now();
  const bufferMs  = 60 * 1000;

  if (_tokenCache.token && now < _tokenCache.expiresAt - bufferMs) {
    return _tokenCache.token;
  }

  logger.info('[auth] Acquiring new Graph access token');
  const result = await getClientApp().acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });

  if (!result?.accessToken) throw new Error('MSAL returned no access token');

  _tokenCache = {
    token:     result.accessToken,
    expiresAt: result.expiresOn?.getTime() ?? now + 3600 * 1000,
  };

  logger.info('[auth] Token acquired, expires', new Date(_tokenCache.expiresAt).toISOString());
  return _tokenCache.token;
}

module.exports = { getAccessToken };
