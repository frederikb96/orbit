/**
 * File Watcher Module
 *
 * Uses @parcel/watcher for reliable recursive directory monitoring on Linux.
 * Uses fs.watch for single-file monitoring.
 */

import { type FSWatcher, watch } from 'node:fs';
import parcelWatcher from '@parcel/watcher';

export interface DirectoryWatcher {
	close(): Promise<void>;
}

/**
 * Create a recursive directory watcher using @parcel/watcher.
 *
 * @param path - Directory path to watch recursively
 * @param onFileChange - Callback invoked with the changed file path
 * @returns DirectoryWatcher instance (call .close() to stop)
 */
export async function createWatcher(
	path: string,
	onFileChange: (filePath: string) => void,
): Promise<DirectoryWatcher> {
	const subscription = await parcelWatcher.subscribe(path, (err, events) => {
		if (err) {
			console.error('Directory watcher error:', err);
			return;
		}
		for (const event of events) {
			if (event.type === 'create' || event.type === 'update') {
				onFileChange(event.path);
			}
		}
	});

	return {
		close: () => subscription.unsubscribe(),
	};
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
