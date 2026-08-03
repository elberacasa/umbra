/**
 * The MCP client configuration snippet docs point users at (Claude Desktop,
 * Cursor, and other MCP-native agents).
 *
 * `umbra-mcp` ships as a bin of the `@elberacasa/umbra` package — there is no
 * separate umbra-mcp package — so npx needs `-p @elberacasa/umbra` to resolve
 * the binary name to the package that provides it.
 */
export const MCP_CONFIG_SNIPPET = {
  mcpServers: {
    umbra: {
      command: 'npx',
      args: ['--yes', '-p', '@elberacasa/umbra', 'umbra-mcp'],
    },
  },
} as const;

/** The same snippet, serialized for pasting into an MCP client config file. */
export const MCP_CONFIG_SNIPPET_JSON = JSON.stringify(MCP_CONFIG_SNIPPET, null, 2);
