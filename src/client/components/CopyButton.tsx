/**
 * CopyButton Component
 *
 * Reusable copy-to-clipboard button with "Copied!" feedback.
 */

import { memo, useCallback, useState } from 'react';

interface CopyButtonProps {
	content: string;
	className?: string;
	title?: string;
}

export const CopyButton = memo(function CopyButton({
	content,
	className = '',
	title = 'Copy to clipboard',
}: CopyButtonProps) {
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(content);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Fallback for older browsers
			const textarea = document.createElement('textarea');
			textarea.value = content;
			textarea.style.position = 'fixed';
			textarea.style.opacity = '0';
			document.body.appendChild(textarea);
			textarea.select();
			try {
				document.execCommand('copy');
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			} catch {
				// Copy failed
			}
			document.body.removeChild(textarea);
		}
	}, [content]);

	return (
		<button
			type="button"
			className={`copy-btn ${copied ? 'copied' : ''} ${className}`}
			onClick={handleCopy}
			title={copied ? 'Copied!' : title}
			aria-label={copied ? 'Copied!' : title}
		>
			{copied ? '✓' : '📋'}
		</button>
	);
});
