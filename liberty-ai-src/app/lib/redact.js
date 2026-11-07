'use strict';
// Scrubs things that look like secrets before any text is shown to an AI.
// It is a safety net, not a guarantee: the Settings page lets you keep logs and
// files on this server by default, and the Audit page shows exactly what was sent.

const RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted private key]'],
  [/\b(?:sk-ant-|sk-|ghp_|gho_|github_pat_|glpat-|xox[abprs]-|AKIA)[A-Za-z0-9_\-]{12,}/g, '[redacted key]'],
  [/\bBearer\s+[A-Za-z0-9._~+\/=-]{12,}/gi, 'Bearer [redacted]'],
  [/\b(authorization|x-api-key|api[_-]?key|apikey|secret|token|passwd|password|passphrase|rpcpassword|rpcauth|macaroon|seed|mnemonic)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi, '$1$2[redacted]'],
  [/(:\/\/)([^\s\/:@]+):([^\s\/@]+)@/g, '$1[user]:[redacted]@'],
  [/\b(?:xprv|yprv|zprv|tprv)[1-9A-HJ-NP-Za-km-z]{50,}\b/g, '[redacted bitcoin key]'],
  [/\b(?:xpub|ypub|zpub|tpub)[1-9A-HJ-NP-Za-km-z]{50,}\b/g, '[redacted bitcoin pubkey]'],
  [/\blnbc[0-9a-z]{20,}\b/gi, '[redacted invoice]'],
  [/\b[0-9a-f]{40,}\b/gi, '[redacted hex]'],
  [/\b[A-Za-z0-9+\/]{48,}={0,2}(?![A-Za-z0-9+\/])/g, '[redacted blob]'],
];

function redact(text) {
  let out = String(text == null ? '' : text);
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}

module.exports = { redact };
