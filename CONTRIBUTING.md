# Contributing to LocalLama MCP

We welcome contributions to the LocalLama MCP Server! This guide provides instructions for setting up a live development environment from source.

## Live Development from Source

For active development, it's recommended to run the server directly from your cloned repository instead of a separate installed location. This allows you to see changes immediately after rebuilding.

### 1. MCP Client Configuration (Windows Example)

Configure your MCP client (e.g., Claude Code, Codex, Cursor) to launch the server from your repository's `dist` directory. The `cwd` should be the repository root, and you should set `LOCALLAMA_ROOT_DIR` to a directory *outside* your repository to keep runtime artifacts (logs, databases, lock files) separate from source code.

**Example for Claude Code (`.claude.json`):**

```json
{
  "mcpServers": {
    "locallama-dev": {
      "command": "node",
      "args": ["C:\\Users\\<you>\\source\\locallama-mcp\\dist\\index.js"],
      "cwd": "C:\\Users\\<you>\\source\\locallama-mcp",
      "env": {
        "LOCALLAMA_ROOT_DIR": "C:\\Users\\<you>\\locallama-dev"
      }
    }
  }
}
```

Replace the paths with the actual location of your repository and desired root directory. `LOCALLAMA_ROOT_DIR` should point to a user-local directory outside the repository.

### 2. Build and Rebuild Cycle

The development workflow relies on a few npm scripts:

- **`npm run build`**: Compiles all TypeScript source files to JavaScript in the `dist/` directory and copies necessary non-TypeScript assets. Run this once initially.
- **`npm run dev`**: Starts the TypeScript compiler (`tsc`) in watch mode. It will automatically recompile files in `src/` when you save changes. It also copies assets once at the start.

**Important:** The `npm run dev` script **does not** start the server. You must manage the server process through your MCP client.

### 3. Reloading the Server

Because this project uses a stdio transport for MCP communication, there is no automatic hot-reloading of the server process when source files change.

The development cycle is:
1. Run `npm run dev` in a terminal and leave it running.
2. Make changes to the source code in `src/`.
3. The `tsc -w` process automatically rebuilds the changed files into `dist/`.
4. **Manually restart the server in your MCP client** (e.g., in Claude Code, reload the MCP server from settings or restart the client session).

The stdio transport ties the MCP host connection to the server process lifetime. When you reload the server, the previous session state is lost. MCP clients do not auto-reconnect to a restarted stdio subprocess; seamless hot reload is out of scope for this workflow.

### `npm link` is Not Supported

Do not use `npm link` to manage this project. The server relies on `import.meta.url` to resolve its root directory for configuration and artifacts, which `npm link` breaks by creating symlinks. Always point your MCP client directly to the `dist/index.js` file in your repository.

```