import { registerRuleExtractor } from './index.js';
import { RuleExtractor } from './rules.js';

/**
 * Bootstrap: importing this module makes createExtractor() return the rule-based
 * reader for "rules" or unset. index.ts never imports rules.ts, so there is no
 * circular import. Entry points (the CLI, the server) import this module.
 */
registerRuleExtractor(() => new RuleExtractor());

export { createExtractor } from './index.js';
