/**
 * useTheme Hook
 *
 * Manages light/dark theme with localStorage persistence
 * and system preference detection.
 */

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'orbit-theme';

function getSystemTheme(): ResolvedTheme {
	if (typeof window === 'undefined') return 'dark';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredTheme(): Theme {
	if (typeof window === 'undefined') return 'system';
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === 'light' || stored === 'dark' || stored === 'system') {
		return stored;
	}
	return 'system';
}

function applyTheme(resolvedTheme: ResolvedTheme): void {
	document.documentElement.setAttribute('data-theme', resolvedTheme);
}

export function useTheme() {
	const [theme, setThemeState] = useState<Theme>(getStoredTheme);
	const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
		const stored = getStoredTheme();
		return stored === 'system' ? getSystemTheme() : stored;
	});

	// Apply theme to DOM and persist
	const setTheme = useCallback((newTheme: Theme) => {
		setThemeState(newTheme);
		localStorage.setItem(STORAGE_KEY, newTheme);

		const resolved = newTheme === 'system' ? getSystemTheme() : newTheme;
		setResolvedTheme(resolved);
		applyTheme(resolved);
	}, []);

	// Cycle through themes: system → light → dark → system
	const cycleTheme = useCallback(() => {
		setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system');
	}, [theme, setTheme]);

	// Listen for system preference changes
	useEffect(() => {
		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

		const handleChange = () => {
			if (theme === 'system') {
				const resolved = getSystemTheme();
				setResolvedTheme(resolved);
				applyTheme(resolved);
			}
		};

		mediaQuery.addEventListener('change', handleChange);
		return () => mediaQuery.removeEventListener('change', handleChange);
	}, [theme]);

	// Apply theme on mount
	useEffect(() => {
		applyTheme(resolvedTheme);
	}, [resolvedTheme]);

	return {
		theme,
		resolvedTheme,
		setTheme,
		cycleTheme,
		isDark: resolvedTheme === 'dark',
	};
}
