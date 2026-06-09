/**
 * services/msAuth.js — MSAL auth code flow for Microsoft SSO
 *
 * Handles the interactive (user-facing) OAuth 2.0 authorization code flow
 * used to sign users into the web dashboard with their Microsoft org credentials.
 *
 * This is separate from services/auth.js which handles the non-interactive
 * client credentials flow used for app-only Graph API access.
 *
 * Flow:
 *   1. /auth/login calls getAuthCodeUrl() → redirects user to Microsoft login
 *   2. Microsoft redirects back to AZURE_REDIRECT_URI with an auth code
 *   3. /auth/callback calls acquireTokenByCode() → gets ID token + account info
 *   4. routes/auth.js issues a JWT cookie from the account info
 *
 * Scopes requested: openid, profile, email, User.Read (delegated — user context)
 * These do not require admin consent and are separate from the application
 * permissions used for Graph API data access.
 */
const msal   = require('@azure/msal-node');
const logger = require('./logger');

const REDIRECT_URI = process.env.AZURE_REDIRECT_URI || 'http://localhost:3000/auth/callback';
const SCOPES       = ['openid', 'profile', 'email', 'User.Read'];

let _pca = null;

function getPca() {
  if (!_pca) {
    _pca = new msal.ConfidentialClientApplication({
      auth: {
        clientId:     process.env.AZURE_CLIENT_ID,
        authority:    `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
      },
      system: {
        loggerOptions: {
          loggerCallback: (level, msg) => { if (level === 0) logger.error('[msal-sso]', msg); },
          piiLoggingEnabled: false,
          logLevel: msal.LogLevel.Error,
        },
      },
    });
  }
  return _pca;
}

/**
 * Returns the Microsoft login URL to redirect the user to.
 * @param {string} state  - CSRF state token, verified in the callback
 */
async function getAuthCodeUrl(state) {
  return getPca().getAuthCodeUrl({ scopes: SCOPES, redirectUri: REDIRECT_URI, state });
}

/**
 * Exchanges the one-time auth code (from the callback query string) for tokens.
 * Returns an MSAL AuthenticationResult; account.name and account.username
 * are used to populate the JWT session cookie.
 * @param {string} code  - Auth code from Microsoft callback
 */
async function acquireTokenByCode(code) {
  return getPca().acquireTokenByCode({ code, scopes: SCOPES, redirectUri: REDIRECT_URI });
}

module.exports = { getAuthCodeUrl, acquireTokenByCode, REDIRECT_URI };
