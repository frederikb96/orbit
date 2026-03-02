/**
 * Markdown Component
 *
 * Renders markdown content with GitHub Flavored Markdown support
 * and syntax-highlighted code blocks.
 */

import { memo, useMemo } from 'react';
import type { Components, ExtraProps } from 'react-markdown';
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
		(): Components => ({
			// Fenced code blocks: intercept at <pre> level to catch language-less blocks
			pre: ({ node, children, ...rest }: React.HTMLAttributes<HTMLPreElement> & ExtraProps) => {
				const codeChild = node?.children?.[0];
				if (codeChild && 'tagName' in codeChild && codeChild.tagName === 'code') {
					const props = (codeChild as { properties?: Record<string, unknown> }).properties;
					const classNames = props?.className;
					const classStr = Array.isArray(classNames) ? classNames.join(' ') : '';
					const match = /language-(\w+)/.exec(classStr);
					const language = match ? match[1] : undefined;
					const children = (codeChild as { children?: { type?: string; value?: string }[] })
						.children;
					const rawText = children?.map((c) => (c.type === 'text' ? c.value : '')).join('') || '';
					return <CodeBlock code={rawText.replace(/\n$/, '')} language={language} />;
				}
				return <pre {...rest}>{children}</pre>;
			},
			// Inline code only (fenced blocks handled by pre override above)
			code: ({ children }: React.HTMLAttributes<HTMLElement> & ExtraProps) => {
				return <InlineCode>{children}</InlineCode>;
			},
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
