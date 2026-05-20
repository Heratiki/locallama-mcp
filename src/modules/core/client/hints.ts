/**
 * Per-client behavioral hints for MCP clients.
 *
 * When a client connects, its name is captured from the MCP initialize
 * handshake via `server.getClientVersion().name` and stored here.
 * Tool handlers and the routing layer can read these hints to tune
 * default behavior without changing tool schemas.
 *
 * Known client names (as reported in the `clientInfo.name` field):
 *   - "claude-code"          Claude Code (Anthropic)
 *   - "codex-cli"            Codex CLI (OpenAI)
 *   - "github-copilot-chat"  GitHub Copilot Chat in VS Code
 *   - "cline"                Cline extension
 *   - "roo-code"             Roo Code extension
 */

export interface ClientHints {
  /**
   * Name of the connected MCP client (lower-cased), or "unknown" if not yet
   * identified.
   */
  clientName: string;

  /**
   * Preferred maximum output size in tokens.  Smaller for clients that favour
   * short inline completions (Copilot Chat), larger for agents that operate in
   * agentic loops (Claude Code, Cline).
   */
  preferredMaxOutputTokens: number;

  /**
   * Target subtask granularity when decomposing large tasks.
   * "fine"   → many small subtasks (good for agents that assemble answers)
   * "coarse" → few large subtasks (good for single-shot completions)
   */
  subtaskGranularity: 'fine' | 'coarse';

  /**
   * When true, the client prefers the result returned as plain text rather
   * than as structured JSON (the JSON is still embedded in content[0].text,
   * but prose clients may display it more cleanly if it's just code).
   */
  preferPlainText: boolean;
}

// ---------------------------------------------------------------------------
// Per-client defaults
// ---------------------------------------------------------------------------

/** Fallback hints used before the first client connects or for unknown clients. */
const DEFAULT_HINTS: ClientHints = {
  clientName: 'unknown',
  preferredMaxOutputTokens: 4096,
  subtaskGranularity: 'coarse',
  preferPlainText: false,
};

const CLIENT_HINT_MAP: Record<string, Partial<ClientHints>> = {
  'claude-code': {
    preferredMaxOutputTokens: 8192,
    subtaskGranularity: 'fine',
    preferPlainText: false,
  },
  'codex-cli': {
    preferredMaxOutputTokens: 4096,
    subtaskGranularity: 'coarse',
    preferPlainText: false,
  },
  'github-copilot-chat': {
    preferredMaxOutputTokens: 2048,
    subtaskGranularity: 'coarse',
    preferPlainText: true,
  },
  'cline': {
    preferredMaxOutputTokens: 8192,
    subtaskGranularity: 'fine',
    preferPlainText: false,
  },
  'roo-code': {
    preferredMaxOutputTokens: 8192,
    subtaskGranularity: 'fine',
    preferPlainText: false,
  },
};

// ---------------------------------------------------------------------------
// Mutable state — updated once at initialization
// ---------------------------------------------------------------------------

let activeHints: ClientHints = { ...DEFAULT_HINTS };

/**
 * Called by `LocalLamaMcpServer` after the MCP initialize handshake
 * completes (i.e., after `server.connect(transport)` resolves and
 * `server.getClientVersion()` returns a non-null value).
 *
 * @param rawClientName  The `name` field from `server.getClientVersion()`,
 *                       or `undefined` if the client did not supply one.
 */
export function setClientHints(rawClientName: string | undefined): void {
  const clientName = (rawClientName ?? 'unknown').toLowerCase().trim();
  const overrides = CLIENT_HINT_MAP[clientName] ?? {};
  activeHints = { ...DEFAULT_HINTS, ...overrides, clientName };
}

/**
 * Returns the hints for the currently connected client.  Safe to call from
 * any tool handler; returns defaults when no client has connected yet.
 */
export function getClientHints(): Readonly<ClientHints> {
  return activeHints;
}
