/**
 * DiffView Component
 *
 * Shows old→new diff with syntax highlighting.
 * Supports split (side-by-side) and unified view modes.
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { getLanguageFromPath } from '../../shared/languages.ts';

// CommonJS require for react-diff-viewer-continued (ESM import has interop issues with Bun)
const ReactDiffViewerLib = require('react-diff-viewer-continued');
const ReactDiffViewer = ReactDiffViewerLib.default || ReactDiffViewerLib;
const DiffMethod = ReactDiffViewerLib.DiffMethod;

interface DiffViewProps {
	oldValue: string;
	newValue: string;
	filePath?: string;
	language?: string;
	maxHeight?: string;
}

export const DiffView = memo(function DiffView({
	oldValue,
	newValue,
	filePath,
	language,
	maxHeight = '500px',
}: DiffViewProps) {
	const [splitView, setSplitView] = useState(false);

	const detectedLanguage = useMemo(() => {
		if (language) return language;
		if (filePath) return getLanguageFromPath(filePath);
		return 'text';
	}, [language, filePath]);

	const toggleSplitView = useCallback(() => {
		setSplitView((prev) => !prev);
	}, []);

	// Custom syntax highlighting for diff content
	const renderContent = useCallback(
		(source: string) => {
			if (!detectedLanguage || detectedLanguage === 'text') {
				return <pre style={{ display: 'inline', margin: 0 }}>{source}</pre>;
			}

			return (
				<SyntaxHighlighter
					language={detectedLanguage}
					style={oneDark}
					customStyle={{
						display: 'inline',
						margin: 0,
						padding: 0,
						background: 'transparent',
						fontSize: 'inherit',
						lineHeight: 'inherit',
					}}
					PreTag="span"
				>
					{source}
				</SyntaxHighlighter>
			);
		},
		[detectedLanguage],
	);

	// Custom styles for dark theme
	const diffStyles = useMemo(
		() => ({
			variables: {
				dark: {
					diffViewerBackground: 'var(--bg-primary)',
					diffViewerColor: 'var(--text-primary)',
					addedBackground: 'rgba(46, 160, 67, 0.15)',
					addedColor: 'var(--text-primary)',
					removedBackground: 'rgba(248, 81, 73, 0.15)',
					removedColor: 'var(--text-primary)',
					wordAddedBackground: 'rgba(46, 160, 67, 0.4)',
					wordRemovedBackground: 'rgba(248, 81, 73, 0.4)',
					addedGutterBackground: 'rgba(46, 160, 67, 0.2)',
					removedGutterBackground: 'rgba(248, 81, 73, 0.2)',
					gutterBackground: 'var(--bg-secondary)',
					gutterBackgroundDark: 'var(--bg-tertiary)',
					highlightBackground: 'var(--bg-hover)',
					highlightGutterBackground: 'var(--bg-hover)',
					codeFoldGutterBackground: 'var(--bg-tertiary)',
					codeFoldBackground: 'var(--bg-secondary)',
					emptyLineBackground: 'var(--bg-primary)',
					gutterColor: 'var(--text-muted)',
					addedGutterColor: 'var(--accent-green)',
					removedGutterColor: 'var(--accent-red)',
					codeFoldContentColor: 'var(--text-secondary)',
				},
			},
			contentText: {
				fontFamily: 'var(--font-mono)',
				fontSize: '0.8rem',
				lineHeight: '1.5',
			},
			gutter: {
				minWidth: '2.5em',
				padding: '0 0.5em',
			},
			diffContainer: {
				borderRadius: '4px',
				overflow: 'hidden',
			},
			codeFold: {
				fontSize: '0.75rem',
			},
		}),
		[],
	);

	return (
		<div className="diff-view">
			<div className="diff-header">
				<button
					type="button"
					className={`diff-toggle ${splitView ? 'split' : 'unified'}`}
					onClick={toggleSplitView}
					title={splitView ? 'Switch to unified view' : 'Switch to split view'}
				>
					{splitView ? '⬜ Split' : '▬ Unified'}
				</button>
			</div>
			<div className="diff-content" style={{ maxHeight, overflow: 'auto' }}>
				<ReactDiffViewer
					oldValue={oldValue}
					newValue={newValue}
					splitView={splitView}
					useDarkTheme={true}
					showDiffOnly={true}
					extraLinesSurroundingDiff={2}
					renderContent={renderContent}
					styles={diffStyles}
					compareMethod={DiffMethod.WORDS}
				/>
			</div>
		</div>
	);
});
