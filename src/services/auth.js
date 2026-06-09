const msal = require('@azure/msal-node');
const logger = require('./logger');

let _clientApp = null;
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
 * Caches the token in memory, refreshes ~1 min before expiry.
 */
async function getAccessToken() {
  const now = Date.now();
  const bufferMs = 60 * 1000; // refresh 1 min early

  if (_tokenCache.token && now < _tokenCache.expiresAt - bufferMs) {
    return _tokenCache.token;
  }

  logger.info('[auth] Acquiring new Graph access token');
  const result = await getClientApp().acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });

  if (!result?.accessToken) {
    throw new Error('MSAL returned no access token');
  }

  _tokenCache = {
    token:     result.accessToken,
    expiresAt: result.expiresOn?.getTime() ?? now + 3600 * 1000,
  };

  logger.info('[auth] Token acquired, expires', new Date(_tokenCache.expiresAt).toISOString());
  return _tokenCache.token;
}

module.exports = { getAccessToken };
