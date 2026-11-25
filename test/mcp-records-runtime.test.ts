/**
 * Runtime guards: while the tools run, nothing touches the network and nothing is written anywhere in the repository.
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSampleStore } from '../tools/mcp-records/data.js';
import { copySampleData, makeTempRoot, realStore, runEverything, treeHash } from './mcp-records-helpers.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('while every tool runs', () => {
  it('nothing uses the network', () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is off')));
    vi.stubGlobal('fetch', fetchSpy);
    const connect = vi.spyOn(net.Socket.prototype, 'connect');
    const lookup = vi.spyOn(dns, 'lookup');
    const httpRequest = vi.spyOn(http, 'request');
    const httpsRequest = vi.spyOn(https, 'request');
    const results = runEverything(realStore());
    expect(results.length).toBeGreaterThan(100);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it('nothing is written in the repository', () => {
    const before = treeHash(process.cwd());
    runEverything(realStore());
    expect(treeHash(process.cwd())).toBe(before);
  });

  it('nothing is written in the samples folder it reads from', () => {
    const dir = join(makeTempRoot(), 'samples');
    copySampleData(dir);
    const before = treeHash(dir);
    runEverything(createSampleStore({ samplesDir: dir }));
    expect(treeHash(dir)).toBe(before);
  });
});
