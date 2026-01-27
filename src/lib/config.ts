/**
 * Orbit Configuration Module
 *
 * Loads config from XDG-compliant location:
 * - $XDG_CONFIG_HOME/orbit/config.json
 * - Fallback: ~/.config/orbit/config.json
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { OrbitConfig, UIConfig } from '../types/index.ts';

const DEFAULT_UI_CONFIG: UIConfig = {
	defaultExpandThinking: false,
	defaultExpandToolCalls: false,
	maxEntriesInMemory: 0, // 0 = unlimited
	maxSessions: 10, // Show last 10 sessions by mtime
	sessionPollInterval: 5_000, // Poll every 5s (0 = disabled)
};

const DEFAULT_CONFIG: OrbitConfig = {
	ui: DEFAULT_UI_CONFIG,
};

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

		// Deep merge with defaults
		cachedConfig = {
			ui: {
				...DEFAULT_UI_CONFIG,
				...(userConfig.ui || {}),
			},
		};

		return cachedConfig;
	} catch {
		// Config parse error - use defaults
		cachedConfig = DEFAULT_CONFIG;
		return cachedConfig;
	}
}

/**
 * Get the config path for documentation purposes.
 */
export function getConfigFilePath(): string {
	return getConfigPath();
}

/**
 * Reset cached config (useful for testing).
 */
export function resetConfigCache(): void {
	cachedConfig = null;
}
