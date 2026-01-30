/**
 * Shared Default Configuration Values
 *
 * Single source of truth for UI defaults.
 * Used by both server (config.ts) and client (ConfigContext.tsx).
 */

import type { UIConfig } from '../types.ts';

export const DEFAULT_UI_CONFIG: UIConfig = {
	defaultExpandThinking: true,
	defaultExpandRead: false, // File contents often long, collapsed by default
	defaultExpandEdit: true,
	defaultExpandOther: true,
	pageSize: 500,
	maxSessions: 10,
	sessionPollIntervalMs: 5_000,
	recentSessionsLimit: 20,
	sseMaxRetries: 10,
	sseBaseDelayMs: 2_000,
	sseMaxDelayMs: 30_000,
	activeThresholdMs: 60_000,
	sessionTitleCommand: undefined,
	sessionTitleIntervalMs: 15_000,
};
