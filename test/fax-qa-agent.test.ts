/**
 * The fax-qa agent definition, .kiro/agents/fax-qa.md: a read-only QA reviewer that uses only the five
 * facsimortis-records tools. This reads the file as text and checks what is written in it. It cannot prove how Kiro
 * enforces it; that is checked in the IDE and recorded in docs/fax-qa-agent-check.md. The front matter is checked line
 * by line (no YAML library), so a new field, a second resource or an extra rule makes a test fail on purpose.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '../tools/mcp-records/tools.js';

// Windows: hand paths with a capital drive letter.
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/^[a-z]:/, (drive) => drive.toUpperCase());
const AGENT_DIR = join(ROOT, '.kiro', 'agents');
const AGENT_PATH = join(AGENT_DIR, 'fax-qa.md');
const SERVER = 'facsimortis-records';
const SELECTORS = TOOL_NAMES.map((name) => `@${SERVER}/${name}`);
const REFUSAL = "I can't do that. I'm a read-only reviewer: I only use the facsimortis-records tools to read the saved sample answers.";

interface Rule {
  capability: string;
  match?: string[];
  exclude?: string[];
  effect: string;
}

function readAgent(): { front: string[]; body: string } {
  const lines = readFileSync(AGENT_PATH, 'utf8').split(/\r?\n/);
  expect(lines[0], 'the file starts with front matter').toBe('---');
  const end = lines.indexOf('---', 1);
  expect(end, 'the front matter is closed').toBeGreaterThan(1);
  return { front: lines.slice(1, end), body: lines.slice(end + 1).join('\n') };
}

const topLevelKeys = (front: string[]) => front.flatMap((line) => /^([A-Za-z]+):/.exec(line)?.[1] ?? []);

function scalar(front: string[], key: string): string {
  const line = front.find((candidate) => candidate.startsWith(`${key}: `));
  if (line === undefined) throw new Error(`${key} is missing from the front matter`);
  return line.slice(key.length + 2);
}

const list = (front: string[], key: string) => JSON.parse(scalar(front, key)) as string[];

function resources(front: string[]): string[] {
  const start = front.indexOf('resources:');
  if (start < 0) throw new Error('resources is missing');
  const found: string[] = [];
  for (const line of front.slice(start + 1)) {
    if (!/^ {2}- /.test(line)) break;
    found.push(line.slice(4));
  }
  return found;
}

function rules(front: string[]): Rule[] {
  const start = front.indexOf('  rules:');
  if (start < 0) throw new Error('permissions.rules is missing');
  const found: Rule[] = [];
  for (const line of front.slice(start + 1)) {
    if (!line.startsWith(' ')) break;
    const head = /^ {4}- capability: (.+)$/.exec(line);
    if (head) {
      found.push({ capability: head[1] as string, effect: '' });
      continue;
    }
    const current = found.at(-1);
    const part = /^ {6}(match|exclude|effect): (.+)$/.exec(line);
    if (!current || !part) throw new Error(`a permissions line this test does not understand: ${line}`);
    if (part[1] === 'effect') current.effect = part[2] as string;
    else current[part[1] as 'match' | 'exclude'] = JSON.parse(part[2] as string) as string[];
  }
  return found;
}

describe('.kiro/agents/fax-qa.md: what the definition says', () => {
  it('exists, is named fax-qa and has exactly these front matter fields', () => {
    expect(existsSync(AGENT_PATH)).toBe(true);
    const { front } = readAgent();
    expect(scalar(front, 'name')).toBe('fax-qa');
    // No hooks (the IDE ignores an agent that has one), no prompt field, no inline server, no allowedTools.
    expect(topLevelKeys(front).sort()).toEqual(
      ['description', 'excludedTools', 'includeMcpJson', 'includePowers', 'name', 'permissions', 'resources', 'tools', 'welcomeMessage'].sort(),
    );
    expect(scalar(front, 'description')).toMatch(/Read-only/);
    expect(scalar(front, 'welcomeMessage')).toMatch(/read-only/);
  });

  it('allows exactly the five records tools, by name, and nothing else', () => {
    const tools = list(readAgent().front, 'tools');
    expect(tools).toEqual(SELECTORS);
    expect(tools).toHaveLength(5);
    for (const tool of tools) {
      expect(tool).not.toBe('*');
      expect(tool).not.toMatch(/^@(builtin|mcp)$/);
      expect(tool).toMatch(new RegExp(`^@${SERVER}/[a-z_]+$`));
    }
    // No category tag, in particular not read.
    expect(tools).not.toContain('read');
    expect(tools.some((tool) => !tool.startsWith('@'))).toBe(false);
  });

  it('excludes write, shell, web and subagent, and does not exclude read or knowledge', () => {
    // Excluding read (or knowledge) hid the MCP tools from the agent in this IDE (found in the A1a variant runs,
    // recorded in docs/fax-qa-agent-check.md). The file reads stay out because the tools list above names only MCP tools.
    const { front } = readAgent();
    const excluded = list(front, 'excludedTools');
    expect(excluded).toEqual(['write', 'shell', 'web', 'subagent']);
    expect(excluded).not.toContain('read');
    expect(excluded).not.toContain('knowledge');
    const tools = list(front, 'tools');
    for (const category of excluded) expect(tools).not.toContain(category);
  });

  it('uses the workspace MCP configuration and no powers', () => {
    const { front } = readAgent();
    expect(scalar(front, 'includeMcpJson')).toBe('true');
    expect(scalar(front, 'includePowers')).toBe('false');
  });

  it('lists product.md as its one resource', () => {
    // Only what the file lists is checked. Kiro also gives custom agents the default steering (the live run showed
    // tech.md loaded too), so this does not claim that product.md is the only steering the agent receives.
    expect(resources(readAgent().front)).toEqual(['file://.kiro/steering/product.md']);
    expect(existsSync(join(ROOT, '.kiro', 'steering', 'product.md'))).toBe(true);
  });

  it('denies every built-in and any read of .env or answer-key files, and allows nothing', () => {
    const found = rules(readAgent().front);
    expect(found).toEqual([
      { capability: 'builtin', effect: 'deny' },
      { capability: 'fs_read', match: ['**/.env', '**/.env.*', '**/*.truth.json'], effect: 'deny' },
    ]);
    expect(found.some((rule) => rule.effect !== 'deny')).toBe(false);
  });
});

describe('.kiro/agents/fax-qa.md: the prompt', () => {
  const { body } = readAgent();

  it('names the five tools and says nothing else may be used', () => {
    for (const name of TOOL_NAMES) expect(body, name).toContain(name);
    expect(body).toContain('Only these five tools of the facsimortis-records server');
    expect(body).toContain('You have no other tools: no file access, no shell and no network.');
  });

  it('has the fixed refusal sentence and makes no tool call for a refused request', () => {
    expect(body).toContain(REFUSAL);
    expect(body).toContain('make no tool call');
    for (const request of ['change, edit, correct, accept, verify, save or write anything', 'read any file', 'run a command', 'use the network']) {
      expect(body, request).toContain(request);
    }
  });

  it('states the 0.85 line as a line for the note, not an app rule', () => {
    expect(body).toContain('0.85 is a line for this QA note, not an app rule');
  });

  it('never invents or corrects a value, and does not call a record correct', () => {
    expect(body).toContain('Never invent, correct, complete, round, reformat or guess a value.');
    expect(body).toContain('Never say a record is correct, verified, compliant or certified.');
    expect(body).toContain('Never use real patient information.');
    expect(body).toContain('Never read other files, including .env and the answer-key files');
  });

  it('says date of birth and phone are not re-checked, and gives the fixed output format', () => {
    expect(body).toContain('Date of birth and phone are not re-checked');
    for (const part of [
      'QA note: <sample id> (synthetic data only; saved answers as read, not reviewed)',
      'Disagreements, model reader vs rules reader:',
      '| Field | Model reader | Rules reader | Flag on |',
      'Unflagged risks (no flag was raised):',
      'What a person should check:',
      'Not checked: date of birth and phone shapes were not re-checked (no tool for that). Nothing was changed.',
    ]) {
      expect(body, part).toContain(part);
    }
  });

  it('makes no compliance claim', () => {
    expect(body).not.toMatch(/HIPAA/i);
    expect(body.replace(/compliant or certified/g, '')).not.toMatch(/complian|certif/i);
  });
});

describe('the agent and the MCP registration', () => {
  it('names the server that .kiro/settings/mcp.json registers, and that file still auto-approves exactly the five tools', () => {
    const config = JSON.parse(readFileSync(join(ROOT, '.kiro', 'settings', 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { autoApprove: string[] }>;
    };
    expect(Object.keys(config.mcpServers)).toEqual([SERVER]);
    expect(config.mcpServers[SERVER]?.autoApprove).toEqual([...TOOL_NAMES]);
    expect(config.mcpServers[SERVER]?.autoApprove).not.toContain('*');
  });
});

describe('the agent files in the repository', () => {
  it('has no leftover variant of the agent', () => {
    expect(readdirSync(AGENT_DIR).filter((name) => /^fax-qa-/.test(name))).toEqual([]);
    expect(readdirSync(AGENT_DIR)).toContain('fax-qa.md');
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
      for (const path of ['.kiro', 'agents', '.kiro/agents', '.kiro/agents/fax-qa.md']) {
        expect(toRegex(pattern).test(path), `${pattern} hides ${path}`).toBe(false);
      }
    }
  });
});