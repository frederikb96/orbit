/**
 * File Watcher Module
 *
 * Uses fs.watch (recursive) for efficient file system monitoring.
 * Only pushes file paths to callback - does NOT read contents.
 */

import { type FSWatcher, watch } from 'node:fs';

/**
 * Create a recursive file watcher.
 *
 * @param path - Directory path to watch recursively
 * @param onFileChange - Callback invoked with the changed file path
 * @returns FSWatcher instance (call .close() to stop)
 */
export function createWatcher(path: string, onFileChange: (filePath: string) => void): FSWatcher {
	const watcher = watch(path, { recursive: true }, (event, filename) => {
		if (event === 'change' && filename) {
			// Construct full path from base path and relative filename
			const fullPath = `${path}/${filename}`;
			onFileChange(fullPath);
		}
	});

	return watcher;
}

/**
 * Create a watcher for a single file.
 *
 * @param filePath - Absolute path to the file to watch
 * @param onFileChange - Callback invoked when file changes
 * @returns FSWatcher instance
 */
export function createFileWatcher(
	filePath: string,
	onFileChange: (filePath: string) => void,
): FSWatcher {
	const watcher = watch(filePath, (event) => {
		if (event === 'change') {
			onFileChange(filePath);
		}
	});

	return watcher;
}
