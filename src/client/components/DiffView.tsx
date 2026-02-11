/**
 * DiffView Component
 *
 * Shows old→new diff using diff2html (GitHub-style diffs).
 * Supports side-by-side and line-by-line view modes.
 */

import { createPatch } from 'diff';
import * as Diff2Html from 'diff2html';
import { ColorSchemeType } from 'diff2html/lib/types';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

interface DiffViewProps {
	oldValue: string;
	newValue: string;
	filePath?: string;
	maxHeight?: string;
}

function getCurrentTheme(): 'dark' | 'light' {
	if (typeof document === 'undefined') return 'dark';
	return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export const DiffView = memo(function DiffView({
	oldValue,
	newValue,
	filePath = 'file',
	maxHeight = '500px',
}: DiffViewProps) {
	const [sideBySide, setSideBySide] = useState(false);
	const [theme, setTheme] = useState<'dark' | 'light'>(getCurrentTheme);

	// Listen for theme changes
	useEffect(() => {
		const observer = new MutationObserver(() => {
			setTheme(getCurrentTheme());
		});
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme'],
		});
		return () => observer.disconnect();
	}, []);

	const toggleSideBySide = useCallback(() => {
		setSideBySide((prev) => !prev);
	}, []);

	// Create unified diff and render HTML
	const diffHtml = useMemo(() => {
		const patch = createPatch(filePath, oldValue, newValue, '', '', { context: 3 });

		return Diff2Html.html(patch, {
			drawFileList: false,
			matching: 'words',
			outputFormat: sideBySide ? 'side-by-side' : 'line-by-line',
			colorScheme: theme === 'dark' ? ColorSchemeType.DARK : ColorSchemeType.LIGHT,
		});
	}, [oldValue, newValue, filePath, sideBySide, theme]);

	return (
		<div className="diff-view">
			<div className="diff-header">
				<button
					type="button"
					className={`diff-toggle ${sideBySide ? 'split' : 'unified'}`}
					onClick={toggleSideBySide}
					title={sideBySide ? 'Switch to unified view' : 'Switch to split view'}
				>
					{sideBySide ? '⬜ Split' : '▬ Unified'}
				</button>
			</div>
			<div
				className={`diff-content diff2html-wrapper ${theme}`}
				style={{ maxHeight, overflow: 'auto' }}
				// biome-ignore lint/security/noDangerouslySetInnerHtml: diff2html output is safe
				dangerouslySetInnerHTML={{ __html: diffHtml }}
			/>
		</div>
	);
});
