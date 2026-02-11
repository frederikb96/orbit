/**
 * AnsiText Component
 *
 * Renders text with ANSI escape codes as colored HTML.
 * Used for Bash command output that contains terminal colors.
 */

import AnsiToHtml from 'ansi-to-html';
import { memo, useMemo } from 'react';

const converter = new AnsiToHtml({
	fg: '#e6edf3',
	bg: 'transparent',
	newline: true,
	escapeXML: true,
});

interface AnsiTextProps {
	text: string;
	className?: string;
}

export const AnsiText = memo(function AnsiText({ text, className = '' }: AnsiTextProps) {
	const html = useMemo(() => converter.toHtml(text), [text]);

	return (
		<pre
			className={className}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: ansi-to-html output is safe (escapeXML: true)
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
});
