import { useEffect, useRef } from 'react';

/**
 * Highlights matching text in the DOM using the CSS Custom Highlight API.
 * Re-applies on DOM mutations (handles Virtuoso item recycling).
 * Requires `::highlight(search-result)` CSS rule for styling.
 */
export function useTextHighlight(
	containerRef: React.RefObject<HTMLElement | null>,
	query: string,
	isActive: boolean,
) {
	const rafRef = useRef(0);

	useEffect(() => {
		const el = containerRef.current;
		if (!isActive || !query.trim() || !el || !CSS.highlights) {
			CSS.highlights?.delete('search-result');
			return;
		}

		const queryLower = query.toLowerCase();

		function applyHighlights() {
			const ranges: Range[] = [];
			const walker = document.createTreeWalker(el!, NodeFilter.SHOW_TEXT);

			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				const text = node.textContent?.toLowerCase() ?? '';
				let startIdx = 0;
				for (
					let idx = text.indexOf(queryLower, startIdx);
					idx !== -1;
					idx = text.indexOf(queryLower, startIdx)
				) {
					const range = new Range();
					range.setStart(node, idx);
					range.setEnd(node, idx + queryLower.length);
					ranges.push(range);
					startIdx = idx + 1;
				}
			}

			if (ranges.length > 0) {
				CSS.highlights.set('search-result', new Highlight(...ranges));
			} else {
				CSS.highlights.delete('search-result');
			}
		}

		applyHighlights();

		const observer = new MutationObserver(() => {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = requestAnimationFrame(applyHighlights);
		});
		observer.observe(el, { childList: true, subtree: true, characterData: true });

		return () => {
			observer.disconnect();
			cancelAnimationFrame(rafRef.current);
			CSS.highlights?.delete('search-result');
		};
	}, [containerRef, query, isActive]);
}
