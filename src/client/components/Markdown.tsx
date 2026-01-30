/**
 * Markdown Component
 *
 * Renders markdown content with GitHub Flavored Markdown support
 * and syntax-highlighted code blocks.
 */

import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { CodeBlock, InlineCode } from './CodeBlock.tsx';

interface MarkdownProps {
	content: string;
	className?: string;
}

export const Markdown = memo(function Markdown({ content, className = '' }: MarkdownProps) {
	const components = useMemo(
		() => ({
			// Fenced code blocks with syntax highlighting
			code: ({
				className: codeClassName,
				children,
			}: {
				className?: string;
				children?: React.ReactNode;
			}) => {
				// Extract language from className (e.g., "language-typescript")
				const match = /language-(\w+)/.exec(codeClassName || '');
				const language = match ? match[1] : undefined;

				// In react-markdown v9+, inline code has no language class
				const isInline = !language;

				if (isInline) {
					return <InlineCode>{children}</InlineCode>;
				}

				const code = String(children).replace(/\n$/, '');

				return <CodeBlock code={code} language={language} />;
			},
			// Override pre to not add extra wrapper
			pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
		}),
		[],
	);

	return (
		<div className={`markdown-content ${className}`}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeSanitize]}
				components={components}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
});
