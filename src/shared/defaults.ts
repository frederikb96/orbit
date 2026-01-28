/**
 * Shared Default Configuration Values
 *
 * Single source of truth for UI defaults.
 * Used by both server (config.ts) and client (ConfigContext.tsx).
 */

import type { UIConfig } from '../types.ts';

export const DEFAULT_UI_CONFIG: UIConfig = {
	defaultExpandThinking: false,
	defaultExpandToolCalls: false,
	pageSize: 500,
	maxSessions: 10,
	sessionPollIntervalMs: 5_000,
	recentSessionsLimit: 20,
	sseMaxRetries: 10,
	sseBaseDelayMs: 2_000,
	sseMaxDelayMs: 30_000,
	sessionTitleCommand: undefined,
	sessionTitleIntervalMs: 15_000,
};
