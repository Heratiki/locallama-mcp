/**
 * Redaction and signature normalization for harness-driven research (#155).
 *
 * Everything here runs before research text leaves the machine: queries go to
 * the user-configured SearXNG instance, notes are shared across repos
 * (criterion 12g), and both are persisted. Absolute paths, repo-private
 * names, usernames and secret-looking values are removed first.
 */

/** Terms that must not leave the machine: repo names, usernames, paths. */
export interface RedactTerms {
  privateTerms?: string[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Absolute paths (POSIX, Windows, ~/…) replaced with <path>. The leading
 * separator must be preceded by whitespace, a quote or an opening bracket so
 * that package paths such as github.com/x/y survive.
 */
const ABSOLUTE_PATH = /(^|[\s"'`(=[:,{])((?:[A-Za-z]:[\\/]|~\/|\/)[^\s"'`)\]},]+)/g;

/** Values of env-like assignments whose name looks credential-related. */
const ENV_VALUE = /([A-Za-z][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|CREDENTIAL|CRED|AUTH)[A-Za-z0-9_]*\s*[:=]\s*)(\S+)/g;

/** Bearer/basic authorization headers and bare long tokens. */
const BEARER = /\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{12,}/gi;

/** Provider token prefixes: sk-…, ghp_…, github_pat_…, xox…, … */
const TOKEN_PREFIX = /\b(?:sk|rk|pk|ghp|gho|ghu|ghs|ghr|github_pat|xox[bpars])[-_][A-Za-z0-9_-]{8,}/g;

const AWS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;

/** Long hex runs (commit ids, digests, addresses). */
const LONG_HEX = /\b[0-9a-fA-F]{16,}\b/g;

/** Long base64-ish runs. */
const LONG_BASE64 = /\b[A-Za-z0-9+/]{32,}={0,2}\b/g;

/** Strip absolute paths, private terms and secret-looking values. */
export function redactText(text: string, terms: RedactTerms = {}): string {
  let out = text.replace(ABSOLUTE_PATH, '$1<path>');
  for (const term of terms.privateTerms ?? []) {
    if (term && term.length >= 4) out = out.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'g'), '<private>');
  }
  out = out
    .replace(ENV_VALUE, '$1<redacted>')
    .replace(BEARER, '$1 <redacted>')
    .replace(TOKEN_PREFIX, '<redacted>')
    .replace(AWS_KEY, '<redacted>')
    .replace(LONG_BASE64, '<redacted>')
    .replace(LONG_HEX, '<redacted>');
  return out;
}

/**
 * Normalization used only to compare two attempts' error signatures
 * (#155 criterion 2): paths, line/column numbers, hex and timestamps become
 * placeholders. Error codes such as TS2339 survive.
 */
export function normalizeSignatureText(text: string): string {
  return text
    // Any token containing a path separator (absolute or relative).
    .replace(/[A-Za-z0-9_.@~\\-]*\/[^\s:(),]*/g, '<path>')
    // Timestamps first, so line/column numbers cannot corrupt them.
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g, '<time>')
    .replace(/\b\d{10,13}\b/g, '<n>')
    .replace(/\(\d+(?:,\s*\d+)?\)/g, '(n)')
    .replace(/:\d+(?::\d+)*/g, ':n')
    .replace(/\bline\s+\d+\b/gi, 'line n')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\s+/g, ' ')
    .trim();
}
