/**
 * Ultra-efficient module for getting N newest files from a directory.
 *
 * Uses readdirSync with recursive option (Node 20+/Bun) for best performance.
 * Target: ~28-30ms for 14k files, N=10.
 */
import { type Dirent, existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface FileWithMtime {
	path: string;
	mtimeMs: number;
}

export interface GetNewestFilesOptions {
	/** Follow symlinks (default: false for safety/speed) */
	followSymlinks?: boolean;
	/** File extension filter, e.g. ".jsonl" (default: all files) */
	extension?: string;
	/** Optional filename predicate - only stat files where this returns true */
	matchFilename?: (filename: string) => boolean;
}

/**
 * Get the N newest files from a directory by modification time.
 *
 * Performance: ~28-30ms for 14k files with N=10.
 *
 * Edge cases handled:
 * - Directory doesn't exist: returns empty array
 * - N > total files: returns all files (up to total)
 * - N <= 0: returns empty array
 * - Permission errors on individual files: skipped silently
 * - Symlinks: optionally followed (default: skipped)
 *
 * @param dirPath - Absolute path to directory to search recursively
 * @param n - Number of newest files to return
 * @param options - Optional configuration
 * @returns Array of {path, mtimeMs} sorted newest-first, length <= n
 */
export function getNewestNFiles(
	dirPath: string,
	n: number,
	options: GetNewestFilesOptions = {},
): FileWithMtime[] {
	if (n <= 0) return [];
	if (!existsSync(dirPath)) return [];

	const { followSymlinks = false, extension, matchFilename } = options;
	const files: FileWithMtime[] = [];

	try {
		const entries = readdirSync(dirPath, {
			recursive: true,
			withFileTypes: true,
		}) as Dirent[];

		for (const entry of entries) {
			if (entry.isDirectory()) continue;

			// parentPath is available in Node 20+ / Bun
			const parentPath = entry.parentPath ?? (entry as unknown as { path: string }).path;
			const fullPath = join(parentPath, entry.name);

			if (entry.isSymbolicLink()) {
				if (!followSymlinks) continue;
				if (extension && !entry.name.endsWith(extension)) continue;
				if (matchFilename && !matchFilename(entry.name)) continue;
				try {
					const stat = statSync(fullPath);
					if (!stat.isFile()) continue;
					files.push({ path: fullPath, mtimeMs: stat.mtimeMs });
				} catch {
					// Target doesn't exist or permission denied
				}
				continue;
			}

			if (!entry.isFile()) continue;
			if (extension && !entry.name.endsWith(extension)) continue;
			if (matchFilename && !matchFilename(entry.name)) continue;

			try {
				const stat = lstatSync(fullPath);
				files.push({ path: fullPath, mtimeMs: stat.mtimeMs });
			} catch {
				// Permission denied or file disappeared
			}
		}
	} catch {
		return [];
	}

	files.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return files.slice(0, n);
}

/**
 * Get all files with their modification times (no limit).
 */
export function getAllFilesWithMtime(
	dirPath: string,
	options: GetNewestFilesOptions = {},
): FileWithMtime[] {
	return getNewestNFiles(dirPath, Number.MAX_SAFE_INTEGER, options);
}
