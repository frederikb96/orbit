/**
 * Orbit Configuration Module
 *
 * Loads config from XDG-compliant location:
 * - $XDG_CONFIG_HOME/orbit/config.json
 * - Fallback: ~/.config/orbit/config.json
 *
 * All defaults centralized here - single source of truth.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_UI_CONFIG } from '../shared/defaults.ts';
import type { OrbitConfig } from '../types.ts';

const DEFAULT_CONFIG: OrbitConfig = {
	sessions: {
		count: 10,
		refreshIntervalMs: 5000,
		watchPath: join(homedir(), '.claude', 'projects'),
	},
	transcript: {
		initialLines: 50, // Initial entries to load (windowed loading)
	},
	ui: DEFAULT_UI_CONFIG,
	server: {
		port: 3000,
	},
};

/**
 * Deep merge user config with defaults.
 * User values override defaults at any nesting level.
 */
function mergeConfig(defaults: OrbitConfig, user: Partial<OrbitConfig>): OrbitConfig {
	const userUi = user.ui as Partial<import('../types.ts').UIConfig> | undefined;
	return {
		sessions: { ...defaults.sessions, ...(user.sessions || {}) },
		transcript: { ...defaults.transcript, ...(user.transcript || {}) },
		ui: {
			...defaults.ui,
			...(userUi || {}),
			v3: { ...defaults.ui.v3, ...(userUi?.v3 || {}) },
		},
		server: { ...defaults.server, ...(user.server || {}) },
	};
}

function getConfigPath(): string {
	const xdgConfig = process.env.XDG_CONFIG_HOME;
	const baseDir = xdgConfig || join(homedir(), '.config');
	return join(baseDir, 'orbit', 'config.json');
}

let cachedConfig: OrbitConfig | null = null;

/**
 * Load config from disk, merging with defaults.
 * Caches result for subsequent calls.
 */
export function getConfig(): OrbitConfig {
	if (cachedConfig) {
		return cachedConfig;
	}

	const configPath = getConfigPath();

	if (!existsSync(configPath)) {
		cachedConfig = DEFAULT_CONFIG;
		return cachedConfig;
	}

	try {
		const content = readFileSync(configPath, 'utf-8');
		const userConfig = JSON.parse(content) as Partial<OrbitConfig>;
		cachedConfig = mergeConfig(DEFAULT_CONFIG, userConfig);
		return cachedConfig;
	} catch (err) {
		console.error(`Failed to parse config at ${configPath}, using defaults:`, err);
		cachedConfig = DEFAULT_CONFIG;
		return cachedConfig;
	}
}

/**
 * Get a fresh config (bypasses cache).
 * Use sparingly - prefer getConfig() for performance.
 */
export function reloadConfig(): OrbitConfig {
	cachedConfig = null;
	return getConfig();
}

/**
 * Get the config file path (for diagnostics).
 */
export function getConfigFilePath(): string {
	return getConfigPath();
}
