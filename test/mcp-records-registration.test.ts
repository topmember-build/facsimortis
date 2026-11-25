/**
 * The Kiro registration of the records server in .kiro/settings/mcp.json: the exact command, no environment
 * variables, autoApprove for exactly the five tools, and every auto-approved tool really read-only. The last point
 * is checked by starting the server the way the entry says, from the repository root, and asking for its tool list.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '../tools/mcp-records/tools.js';

// Windows: hand child processes a path with a capital drive letter.
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/^[a-z]:/, (drive) => drive.toUpperCase());
const CONFIG_PATH = join(ROOT, '.kiro', 'settings', 'mcp.json');
const NAME = 'facsimortis-records';
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

interface ServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
  autoApprove: string[];
  [key: string]: unknown;
}

function readConfig(): { text: string; config: { mcpServers: Record<string, ServerEntry> } } {
  const text = readFileSync(CONFIG_PATH, 'utf8');
  return { text, config: JSON.parse(text) as { mcpServers: Record<string, ServerEntry> } };
}

function entry(): ServerEntry {
  const server = readConfig().config.mcpServers[NAME];
  if (!server) throw new Error(`${NAME} is not in .kiro/settings/mcp.json`);
  return server;
}

/** Starts the server exactly as the entry says, sends the 2025 handshake and tools/list, then closes stdin. */
async function listToolsAsConfigured(server: ServerEntry) {
  const child = spawn(server.command, server.args, {
    cwd: ROOT,
    env: { ...process.env, ...server.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => (stderr += chunk));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  const list = new Promise<{ tools: { name: string; annotations?: unknown }[] }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no tool list within 20 s. stderr: ${stderr}`)), 20_000);
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line) as { id?: number; result?: { tools: { name: string; annotations?: unknown }[] } };
          if (message.id === 2 && message.result) {
            clearTimeout(timer);
            resolve(message.result);
          }
        } catch {
          // a line still being written; the next chunk completes it
        }
      }
    });
  });
  const send = (message: Record<string, unknown>) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'facsimortis-test', version: '1.0.0' } } });
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  try {
    return { result: await list, stderr: () => stderr };
  } finally {
    child.stdin.end();
    const code = await Promise.race([exited, new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 15_000))]);
    if (code === 'timeout') child.kill();
    expect(code).toBe(0);
  }
}

describe('.kiro/settings/mcp.json', () => {
  it('exists and registers the records server', () => {
    expect(existsSync(CONFIG_PATH)).toBe(true);
    const { config } = readConfig();
    expect(Object.keys(config)).toEqual(['mcpServers']);
    expect(config.mcpServers[NAME]).toBeDefined();
  });

  it('starts node with tsx and the server file, with no environment variables and nothing else', () => {
    const server = entry();
    expect(Object.keys(server).sort()).toEqual(['args', 'autoApprove', 'command', 'env']);
    expect(server.command).toBe('node');
    expect(server.args).toEqual(['--import', 'tsx', 'tools/mcp-records/server.ts']);
    expect(server.env).toEqual({});
    expect(readConfig().text).not.toContain('${');
    expect(existsSync(join(ROOT, 'tools', 'mcp-records', 'server.ts'))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { devDependencies?: Record<string, string> };
    expect(pkg.devDependencies?.tsx).toBeDefined();
  });

  it('auto-approves exactly the five tools, by name', () => {
    const server = entry();
    expect(server.autoApprove).toEqual([...TOOL_NAMES]);
    expect(server.autoApprove).not.toContain('*');
  });

  it('is not hidden by .gitignore', () => {
    const patterns = readFileSync(join(ROOT, '.gitignore'), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('!'));
    const toRegex = (pattern: string) =>
      new RegExp(
        `^${pattern
          .replace(/^\//, '')
          .replace(/\/$/, '')
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '[^/]')}$`,
      );
    for (const pattern of patterns) {
      for (const path of ['.kiro', 'settings', 'mcp.json', '.kiro/settings', '.kiro/settings/mcp.json']) {
        expect(toRegex(pattern).test(path), `${pattern} hides ${path}`).toBe(false);
      }
    }
  });

  it('every auto-approved tool is read-only: the server started as configured lists exactly those tools', async () => {
    const server = entry();
    const { result, stderr } = await listToolsAsConfigured(server);
    expect(result.tools.map((tool) => tool.name)).toEqual(server.autoApprove);
    for (const tool of result.tools) expect(tool.annotations, tool.name).toEqual(READ_ONLY);
    expect(stderr()).toContain('facsimortis-records: ready');
  });
});
