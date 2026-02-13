/**
 * File Watcher Module
 *
 * Uses @parcel/watcher for reliable recursive directory monitoring on Linux.
 * Uses fs.watch for single-file monitoring.
 */

import { dirname } from 'node:path';
import parcelWatcher from '@parcel/watcher';

export interface DirectoryWatcher {
	close(): Promise<void>;
}

export interface FileWatcher {
	close(): void;
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
 * Create a watcher for a single file using @parcel/watcher.
 * Watches the parent directory and filters for the target file.
 */
export async function createFileWatcher(
	filePath: string,
	onFileChange: (filePath: string) => void,
): Promise<FileWatcher> {
	const dir = dirname(filePath);
	const subscription = await parcelWatcher.subscribe(dir, (err, events) => {
		if (err) {
			console.error('File watcher error:', err);
			return;
		}
		for (const event of events) {
			if (event.path === filePath && (event.type === 'create' || event.type === 'update')) {
				onFileChange(filePath);
			}
		}
	});

	return {
		close() {
			subscription.unsubscribe();
		},
	};
}
