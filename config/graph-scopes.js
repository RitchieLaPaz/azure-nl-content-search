/**
 * config/graph-scopes.js — Microsoft Graph API permission scope reference
 *
 * Documents the application permissions required for each M365 capability
 * used by POST /search (live Graph API execution).
 *
 * All permissions use the client_credentials flow (.default scope) which
 * requires admin consent in your Azure AD tenant. Grant consent at:
 * portal.azure.com → App registrations → your app → API permissions → Grant admin consent
 *
 * Note: POST /compliance (KQL generation) does not call Graph API and requires
 * none of these permissions. Only POST /search requires them.
 */

const SCOPES = {
  mail:       ['https://graph.microsoft.com/.default'],  // Mail.Read.All
  teams:      ['https://graph.microsoft.com/.default'],  // ChannelMessage.Read.All
  sharepoint: ['https://graph.microsoft.com/.default'],  // Sites.Read.All
  calendar:   ['https://graph.microsoft.com/.default'],  // Calendars.Read
  auditlogs:  ['https://graph.microsoft.com/.default'],  // AuditLog.Read.All
  users:      ['https://graph.microsoft.com/.default'],  // User.Read.All
  onedrive:   ['https://graph.microsoft.com/.default'],  // Files.Read.All
};

// Maps Claude's service labels to the capability keys above
const CAPABILITY_MAP = {
  'Exchange':      'mail',
  'Teams':         'teams',
  'SharePoint':    'sharepoint',
  'Calendar':      'calendar',
  'Azure AD':      'auditlogs',
  'OneDrive':      'onedrive',
  'Azure Monitor': 'auditlogs',
};

module.exports = { SCOPES, CAPABILITY_MAP };
