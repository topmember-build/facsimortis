import { registerLocalAdapter } from './index.js';
import { LocalOcrAdapter } from './local.js';

/**
 * Bootstrap: importing this module makes createOcrAdapter() return the local
 * reader for "local" or unset. index.ts never imports local.ts, so there is no
 * circular import. Entry points (the CLI, the server) import this module.
 */
registerLocalAdapter(() => new LocalOcrAdapter());

export { createOcrAdapter } from './index.js';
