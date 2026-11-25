/**
 * The read-only records server: the five tools of tools.ts over stdio, using the official MCP SDK.
 *
 * Start it with: node --import tsx tools/mcp-records/server.ts (it is meant to be started by an MCP client).
 *
 * - Only this file imports the protocol layer. The tools themselves are plain functions in tools.ts.
 * - stdout belongs to the protocol. Nothing here writes to it directly; the one startup line goes to stderr, and it
 *   never contains arguments or data.
 * - serveStdio serves both protocol eras from one factory. It exits when the client closes stdin.
 * - Importing this file starts the server. Tests run it as a separate process.
 */
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createSampleStore } from './data.js';
import { TOOLS } from './tools.js';

const SERVER_NAME = 'facsimortis-records';
const SERVER_VERSION = '0.1.0';

/** Every tool only reads the committed sample files. The hints tell a client that it is safe to call them freely. */
const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function textResult(text: string, isError: boolean) {
  return isError ? { content: [{ type: 'text' as const, text }], isError: true } : { content: [{ type: 'text' as const, text }] };
}

function createRecordsServer(): McpServer {
  const store = createSampleStore();
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: 'Read-only tools over synthetic sample faxes. Values are exactly as saved; nothing is corrected or guessed.' },
  );
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, annotations: ANNOTATIONS },
      (args: unknown) => {
        try {
          const result = tool.run(store, args);
          if (!result.ok) return textResult(result.message, true);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
            structuredContent: result.data as Record<string, unknown>,
          };
        } catch {
          // Never put the arguments or the error text on the wire: say only that the tool failed.
          console.error(`${SERVER_NAME}: the ${tool.name} tool failed unexpectedly`);
          return textResult('The tool failed unexpectedly. Nothing was changed.', true);
        }
      },
    );
  }
  return server;
}

serveStdio(() => createRecordsServer(), {
  onerror: (error) => console.error(`${SERVER_NAME}: protocol problem (${error.name})`),
});
console.error(`${SERVER_NAME}: ready (read-only, synthetic data)`);
