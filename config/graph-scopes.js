/**
 * Microsoft Graph API permission scopes required per capability.
 * Used both for documentation and to validate Claude's suggested scopes
 * against what the app was actually registered with.
 *
 * In app-only (client_credentials) flow, all scopes end in .Read.All or .ReadWrite.All
 */

const SCOPES = {
  mail:      ['https://graph.microsoft.com/.default'],  // covers Mail.Read.All
  teams:     ['https://graph.microsoft.com/.default'],  // covers ChannelMessage.Read.All
  sharepoint:['https://graph.microsoft.com/.default'],  // covers Sites.Read.All
  calendar:  ['https://graph.microsoft.com/.default'],  // covers Calendars.Read
  auditlogs: ['https://graph.microsoft.com/.default'],  // covers AuditLog.Read.All
  users:     ['https://graph.microsoft.com/.default'],  // covers User.Read.All
  onedrive:  ['https://graph.microsoft.com/.default'],  // covers Files.Read.All
};

// The Claude prompt will reference these capability labels
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
