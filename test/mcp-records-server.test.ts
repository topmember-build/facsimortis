/**
 * The real records server as a separate process over stdio, the way an MCP client starts it. It is started from an
 * empty temporary folder (not the repository) to show it does not depend on the working directory, with a canary in
 * its environment that must never come back. It speaks raw JSON-RPC lines, one session per protocol era.
 * Also: static checks on server.ts, which is the only file allowed to import the protocol layer.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, outputs } from '../tools/mcp-records/tools.js';
import { makeTempRoot, treeHash } from './mcp-records-helpers.js';

// Windows: hand child processes a path with a capital drive letter.
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/^[a-z]:/, (drive) => drive.toUpperCase());
const SERVER = join(ROOT, 'tools', 'mcp-records', 'server.ts');
const TSX_LOADER = pathToFileURL(join(ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;
const CANARY = 'CANARY-SERVER-ENV-4e81b0d6';
const KEY = 'tru' + 'th';
const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const LONG = 'x'.repeat(10 * 1024);

const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'facsimortis-test', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

const VALID_CALLS: Record<(typeof TOOL_NAMES)[number], Record<string, unknown>> = {
  list_samples: {},
  get_result: { sample: 'fax-0003', reader: 'rules' },
  explain_flag: { sample: 'fax-0003', field: 'npi' },
  check_npi: { npi: '1234567893' },
  export_summary: { sample: 'fax-0002' },
};

interface JsonRpc {
  jsonrpc?: unknown;
  id?: unknown;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface ToolsListResult {
  tools: { name: string; description: string; inputSchema: Record<string, unknown>; outputSchema?: unknown; annotations?: unknown }[];
}

interface CallResult {
  content: { type: string; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

/** One server process and a line-based JSON-RPC client for it. */
class Session {
  readonly cwd = makeTempRoot('fx-mcp-cwd-');
  readonly lines: string[] = [];
  readonly badLines: string[] = [];
  stderr = '';
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private readonly waiting = new Map<number, (message: JsonRpc) => void>();
  readonly exited: Promise<number | null>;

  constructor() {
    this.child = spawn(process.execPath, ['--import', TSX_LOADER, SERVER], {
      cwd: this.cwd,
      env: { ...process.env, MCP_RECORDS_CANARY: CANARY, API_KEY: CANARY },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => (this.stderr += chunk));
    this.child.stdout.on('data', (chunk: string) => this.onData(chunk));
    this.exited = new Promise((resolve) => this.child.on('exit', (code) => resolve(code)));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf('\n');
      if (line === '') continue;
      this.lines.push(line);
      let message: JsonRpc;
      try {
        message = JSON.parse(line) as JsonRpc;
      } catch {
        this.badLines.push(line);
        continue;
      }
      if (message.jsonrpc !== '2.0') this.badLines.push(line);
      if (typeof message.id === 'number') this.waiting.get(message.id)?.(message);
    }
  }

  send(message: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  }

  request(id: number, method: string, params?: Record<string, unknown>): Promise<JsonRpc> {
    const answer = new Promise<JsonRpc>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer to ${method} (id ${id}) within 20 s. stderr: ${this.stderr}`)), 20_000);
      this.waiting.set(id, (message) => {
        clearTimeout(timer);
        this.waiting.delete(id);
        resolve(message);
      });
    });
    this.send({ id, method, ...(params === undefined ? {} : { params }) });
    return answer;
  }

  /** Closes stdin, as a client does when it is done, and waits for the process to exit by itself. */
  async close(): Promise<number | null> {
    this.child.stdin.end();
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 15_000));
    const result = await Promise.race([this.exited, timeout]);
    if (result === 'timeout') {
      this.child.kill();
      throw new Error('the server did not exit within 15 s of stdin closing');
    }
    return result;
  }
}

function callResult(message: JsonRpc): CallResult {
  expect(message.error).toBeUndefined();
  return message.result as unknown as CallResult;
}

function expectCleanStreams(session: Session): void {
  expect(session.badLines).toEqual([]);
  const stdout = session.lines.join('\n');
  for (const text of [stdout, session.stderr]) {
    expect(text).not.toContain(CANARY);
    expect(text.toLowerCase()).not.toContain(KEY);
    expect(text).not.toContain('x'.repeat(100));
  }
  // stderr carries the startup line and short problem notes, never arguments or sample data.
  expect(session.stderr).toContain('facsimortis-records: ready');
  for (const leaked of ['fax-000', '6720988041', '1234567893', 'package.json', 'win.ini']) expect(session.stderr).not.toContain(leaked);
}

describe('the records server process', () => {
  it('serves a 2025-era client: handshake, five read-only tools, every call, hostile arguments, exit on stdin close', async () => {
    const repoBefore = treeHash(ROOT);
    const session = new Session();
    try {
      const init = await session.request(1, 'initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'facsimortis-test', version: '1.0.0' },
      });
      expect(init.error).toBeUndefined();
      expect(init.result?.protocolVersion).toBe('2025-11-25');
      expect(init.result?.serverInfo).toEqual({ name: 'facsimortis-records', version: '0.1.0' });
      session.send({ method: 'notifications/initialized' });

      const list = (await session.request(2, 'tools/list')).result as unknown as ToolsListResult;
      expect(list.tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
      for (const tool of list.tools) {
        expect(tool.annotations).toEqual(ANNOTATIONS);
        expect(tool.outputSchema).toBeDefined();
        expect(tool.inputSchema.additionalProperties).toBe(false);
      }
      expect(list.tools.find((tool) => tool.name === 'export_summary')?.description).toMatch(/AS READ AND NOT REVIEWED/);
      const explain = list.tools.find((tool) => tool.name === 'explain_flag');
      expect((explain?.inputSchema.required as string[]).sort()).toEqual(['field', 'sample']);

      let id = 10;
      for (const name of TOOL_NAMES) {
        const result = callResult(await session.request(id++, 'tools/call', { name, arguments: VALID_CALLS[name] }));
        expect(result.isError ?? false).toBe(false);
        expect(outputs[name].safeParse(result.structuredContent).success).toBe(true);
        expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(result.structuredContent);
      }
      const npi = callResult(await session.request(id++, 'tools/call', { name: 'explain_flag', arguments: VALID_CALLS.explain_flag }));
      expect((npi.structuredContent as { reader: string; value: string }).reader).toBe('model');
      expect((npi.structuredContent as { value: string }).value).toBe('6720988041');

      // Each hostile call is refused, either by the SDK's own check against the input schema or by the tool itself.
      // The message says which: a tool refusal that lost its isError flag would be replaced by an SDK output error.
      const BY_SDK = /^Input validation error: Invalid arguments for tool \w+:/;
      const BY_TOOL = /^Unknown sample\. Known samples: fax-0001, fax-0002, fax-0003\.$/;
      const hostile: [string, Record<string, unknown>, RegExp][] = [
        ['get_result', { sample: '../../package.json', reader: 'model' }, BY_TOOL],
        ['get_result', { sample: 'C:\\Windows\\win.ini', reader: 'model' }, BY_TOOL],
        ['get_result', { sample: `fax-0003.${KEY}`, reader: 'model' }, BY_TOOL],
        ['export_summary', { sample: '..' }, BY_TOOL],
        ['get_result', { sample: LONG, reader: 'model' }, BY_SDK],
        ['get_result', { sample: 'fax-0001', reader: 'model', extra: 1 }, BY_SDK],
        ['get_result', { sample: 'fax-0001' }, BY_SDK],
        ['explain_flag', { sample: 'fax-0001', field: 'ssn' }, BY_SDK],
        ['check_npi', { npi: 1234567893 }, BY_SDK],
        ['check_npi', { npi: LONG }, BY_SDK],
        ['export_summary', { sample: null }, BY_SDK],
        ['list_samples', { sample: 'fax-0001' }, BY_SDK],
      ];
      for (const [name, args, expected] of hostile) {
        const result = callResult(await session.request(id++, 'tools/call', { name, arguments: args }));
        const label = `${name} ${JSON.stringify(args).slice(0, 80)}`;
        expect(result.isError, label).toBe(true);
        expect(result.structuredContent, label).toBeUndefined();
        expect(result.content, label).toHaveLength(1);
        expect(result.content[0]?.text, label).toMatch(expected);
      }

      const unknown = await session.request(id++, 'tools/call', { name: 'write_record', arguments: {} });
      expect(unknown.result).toBeUndefined();
      expect(unknown.error?.code).toBe(-32602);
    } finally {
      expect(await session.close()).toBe(0);
    }
    expectCleanStreams(session);
    expect(readdirSync(session.cwd)).toEqual([]);
    expect(treeHash(ROOT)).toBe(repoBefore);
  });

  it('serves a 2026-era client: discover, the tool list and a call, each with the _meta envelope', async () => {
    const session = new Session();
    try {
      const discover = await session.request(1, 'server/discover', { _meta: MODERN_META });
      expect(discover.error).toBeUndefined();
      expect(discover.result?.supportedVersions).toContain('2026-07-28');
      expect(discover.result?._meta).toEqual({ 'io.modelcontextprotocol/serverInfo': { name: 'facsimortis-records', version: '0.1.0' } });

      const list = (await session.request(2, 'tools/list', { _meta: MODERN_META })).result as unknown as ToolsListResult;
      expect(list.tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
      for (const tool of list.tools) expect(tool.annotations).toEqual(ANNOTATIONS);

      const call = callResult(await session.request(3, 'tools/call', { name: 'explain_flag', arguments: { sample: 'fax-0003', field: 'callbackPhone' }, _meta: MODERN_META }));
      expect(call.isError ?? false).toBe(false);
      expect(outputs.explain_flag.safeParse(call.structuredContent).success).toBe(true);

      const hostile = callResult(await session.request(4, 'tools/call', { name: 'get_result', arguments: { sample: '..', reader: 'model' }, _meta: MODERN_META }));
      expect(hostile.isError).toBe(true);

      const noEnvelope = await session.request(5, 'tools/list', {});
      expect(noEnvelope.error?.code).toBe(-32602);
    } finally {
      expect(await session.close()).toBe(0);
    }
    expectCleanStreams(session);
    expect(readdirSync(session.cwd)).toEqual([]);
  });

  it('exits by itself when stdin closes before any message', async () => {
    const session = new Session();
    expect(await session.close()).toBe(0);
    expect(session.lines).toEqual([]);
  });
});

describe('server.ts', () => {
  const source = readFileSync(SERVER, 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('imports only the protocol layer and the two local modules', () => {
    const imports = [...code.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((match) => match[1]).sort();
    expect(imports).toEqual(['./data.js', './tools.js', '@modelcontextprotocol/server', '@modelcontextprotocol/server/stdio']);
  });

  it('never mentions the answer-key files and has no file system, network, process.env, stdout or dynamic code', () => {
    expect(source.toLowerCase()).not.toContain(KEY);
    for (const pattern of [/['"](node:)?fs/, /child_process/, /\bfetch\s*\(/, /process\s*\.\s*(env|stdout)/, /console\s*\.\s*(log|info|debug)/, /\bimport\s*\(/, /\brequire\s*\(/, /\beval\s*\(/]) {
      expect(pattern.test(code), String(pattern)).toBe(false);
    }
  });

  it('is linted with the records rules: the protocol layer is allowed here and nothing else is', async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const lint = async (text: string) => {
      const [result] = await eslint.lintText(text, { filePath: join(ROOT, 'tools', 'mcp-records', 'server.ts') });
      return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-syntax');
    };
    expect(await lint("import { McpServer } from '@modelcontextprotocol/server';\nimport { serveStdio } from '@modelcontextprotocol/server/stdio';\nexport default [McpServer, serveStdio];")).toEqual([]);
    for (const text of [
      "import fs from 'node:fs';\nexport default fs;",
      "import h from 'node:http';\nexport default h;",
      "import x from '../../web/src/record.js';\nexport default x;",
      "process.stdout.write('x');",
      "console.log('x');",
      'export const a = process.env.KEY;',
    ]) {
      expect((await lint(text)).length, text).toBeGreaterThan(0);
    }
  });
});
