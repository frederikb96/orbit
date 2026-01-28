/**
 * Event Buffer Module
 *
 * Simple buffer for batching file change events.
 * Deduplicates paths and provides atomic consume operation.
 */

export class EventBuffer {
	private paths: Set<string> = new Set();

	/**
	 * Add a path to the buffer.
	 * Duplicate paths are automatically deduplicated.
	 */
	push(path: string): void {
		this.paths.add(path);
	}

	/**
	 * Consume all buffered paths and clear the buffer.
	 * Returns unique paths that were buffered.
	 */
	consume(): string[] {
		const result = Array.from(this.paths);
		this.paths.clear();
		return result;
	}

	/**
	 * Check if buffer has any pending paths.
	 */
	isEmpty(): boolean {
		return this.paths.size === 0;
	}

	/**
	 * Get current buffer size without consuming.
	 */
	size(): number {
		return this.paths.size;
	}
}
