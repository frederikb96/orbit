/**
 * LazyDiffView Component
 *
 * React.lazy wrapper around DiffView to defer loading
 * the heavy react-diff-viewer library until needed.
 */

import { Suspense, lazy, memo } from 'react';

// Lazy load the full DiffView component
const DiffViewLazy = lazy(() =>
	import('./DiffView.tsx').then((mod) => ({ default: mod.DiffView })),
);

interface LazyDiffViewProps {
	oldValue: string;
	newValue: string;
	filePath?: string;
	language?: string;
	maxHeight?: string;
}

/**
 * Loading placeholder for diff view.
 * minHeight prevents layout shift when lazy component loads.
 */
function DiffViewFallback({ maxHeight }: { maxHeight: string }) {
	return (
		<div className="diff-view-loading" style={{ maxHeight, minHeight: '120px' }}>
			<div className="diff-loading-content">Loading diff...</div>
		</div>
	);
}

/**
 * Lazy-loaded diff view wrapper.
 * Only loads react-diff-viewer when component is rendered.
 */
export const LazyDiffView = memo(function LazyDiffView({
	oldValue,
	newValue,
	filePath,
	language,
	maxHeight = '500px',
}: LazyDiffViewProps) {
	return (
		<Suspense fallback={<DiffViewFallback maxHeight={maxHeight} />}>
			<DiffViewLazy
				oldValue={oldValue}
				newValue={newValue}
				filePath={filePath}
				language={language}
				maxHeight={maxHeight}
			/>
		</Suspense>
	);
});
