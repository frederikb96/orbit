/**
 * CodeBlock Component
 *
 * Lazy syntax-highlighted code display with IntersectionObserver.
 * Shows raw code immediately, highlights when visible using Shiki.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { getLanguageFromPath, normalizeLanguage } from '../../shared/languages.ts';
import { highlightAsync, isLikelySupported } from '../lib/highlighter.ts';

interface CodeBlockProps {
	code: string;
	language?: string;
	filePath?: string;
	showLineNumbers?: boolean;
	startingLineNumber?: number;
	maxHeight?: string;
}

export const CodeBlock = memo(function CodeBlock({
	code,
	language,
	filePath,
	showLineNumbers = false,
	startingLineNumber = 1,
	maxHeight = '500px',
}: CodeBlockProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
	const [isVisible, setIsVisible] = useState(false);

	const detectedLanguage = useMemo(() => {
		if (language) return normalizeLanguage(language);
		if (filePath) return getLanguageFromPath(filePath);
		return 'text';
	}, [language, filePath]);

	// IntersectionObserver to detect when code block is visible
	useEffect(() => {
		const element = containerRef.current;
		if (!element) return;

		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					setIsVisible(true);
					observer.disconnect();
				}
			},
			{ rootMargin: '100px' }, // Start loading slightly before visible
		);

		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	// Highlight code when visible
	useEffect(() => {
		if (!isVisible || highlightedHtml) return;
		if (!detectedLanguage || detectedLanguage === 'text') return;
		if (!isLikelySupported(detectedLanguage)) return;

		let cancelled = false;

		highlightAsync(code, detectedLanguage).then((html) => {
			if (!cancelled && html) {
				setHighlightedHtml(html);
			}
		});

		return () => {
			cancelled = true;
		};
	}, [isVisible, code, detectedLanguage, highlightedHtml]);

	// Line numbers for raw display
	const lineNumbers = useMemo(() => {
		if (!showLineNumbers) return null;
		const lines = code.split('\n');
		return lines.map((_, i) => startingLineNumber + i);
	}, [code, showLineNumbers, startingLineNumber]);

	const containerStyle = useMemo(
		() => ({
			maxHeight,
			overflow: 'auto',
		}),
		[maxHeight],
	);

	// Highlighted HTML display
	if (highlightedHtml) {
		return (
			<div ref={containerRef} className="code-block code-block-highlighted" style={containerStyle}>
				{showLineNumbers && lineNumbers && (
					<div className="code-line-numbers">
						{lineNumbers.map((num) => (
							<span key={num} className="line-number">
								{num}
							</span>
						))}
					</div>
				)}
				<div
					className="code-content shiki-container"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output is safe
					dangerouslySetInnerHTML={{ __html: highlightedHtml }}
				/>
			</div>
		);
	}

	// Raw code display (initial or fallback)
	return (
		<div ref={containerRef} className="code-block code-block-raw" style={containerStyle}>
			{showLineNumbers && lineNumbers && (
				<div className="code-line-numbers">
					{lineNumbers.map((num) => (
						<span key={num} className="line-number">
							{num}
						</span>
					))}
				</div>
			)}
			<pre className="code-content">
				<code>{code}</code>
			</pre>
		</div>
	);
});

/**
 * Inline code component for markdown rendering.
 */
export const InlineCode = memo(function InlineCode({ children }: { children: React.ReactNode }) {
	return <code className="inline-code">{children}</code>;
});
