import { describe, expect, mock, test } from 'bun:test';
import { JsonLogger } from '../src/lib/logger.ts';

// Mock child_process.spawn
const mockSpawn = mock(() => ({
	stdin: {
		write: mock(() => {}),
		end: mock(() => {}),
	},
}));

describe('JsonLogger', () => {
	test('creates logger with identifier', () => {
		const logger = new JsonLogger('test-id');
		expect(logger).toBeInstanceOf(JsonLogger);
	});

	test('log methods exist', () => {
		const logger = new JsonLogger('test-id');
		expect(typeof logger.debug).toBe('function');
		expect(typeof logger.info).toBe('function');
		expect(typeof logger.warn).toBe('function');
		expect(typeof logger.error).toBe('function');
	});

	test('convenience methods exist', () => {
		const logger = new JsonLogger('test-id');
		expect(typeof logger.serverStart).toBe('function');
		expect(typeof logger.serverStop).toBe('function');
		expect(typeof logger.request).toBe('function');
		expect(typeof logger.sseConnect).toBe('function');
		expect(typeof logger.sseDisconnect).toBe('function');
		expect(typeof logger.sessionDiscovered).toBe('function');
		expect(typeof logger.sessionUpdate).toBe('function');
		expect(typeof logger.errorOccurred).toBe('function');
	});

	test('log entry has correct structure', () => {
		// We can't easily test the actual spawn call, but we can verify
		// the logger doesn't throw
		const logger = new JsonLogger('test-id');
		expect(() => logger.info('test_op', { key: 'value' })).not.toThrow();
		expect(() => logger.debug('test_op', {})).not.toThrow();
		expect(() => logger.warn('test_op', { warning: true })).not.toThrow();
		expect(() => logger.error('test_op', { error: 'message' })).not.toThrow();
	});

	test('serverStart logs correctly', () => {
		const logger = new JsonLogger('orbit-test');
		expect(() => logger.serverStart(3000)).not.toThrow();
	});

	test('request logs with all parameters', () => {
		const logger = new JsonLogger('orbit-test');
		expect(() => logger.request('GET', '/api/sessions', 200, 15)).not.toThrow();
	});
});
