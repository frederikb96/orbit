/**
 * LazyDiffView Component
 *
 * React.lazy wrapper around DiffView to defer loading
 * the diff2html library until needed.
 */

import { Suspense, lazy, memo } from 'react';

const DiffViewLazy = lazy(() =>
	import('./DiffView.tsx').then((mod) => ({ default: mod.DiffView })),
);

interface LazyDiffViewProps {
	oldValue: string;
	newValue: string;
	filePath?: string;
	maxHeight?: string;
}

function DiffViewFallback({ maxHeight }: { maxHeight: string }) {
	return (
		<div className="diff-view-loading" style={{ maxHeight, minHeight: '120px' }}>
			<div className="diff-loading-content">Loading diff...</div>
		</div>
	);
}

export const LazyDiffView = memo(function LazyDiffView({
	oldValue,
	newValue,
	filePath,
	maxHeight = '500px',
}: LazyDiffViewProps) {
	return (
		<Suspense fallback={<DiffViewFallback maxHeight={maxHeight} />}>
			<DiffViewLazy
				oldValue={oldValue}
				newValue={newValue}
				filePath={filePath}
				maxHeight={maxHeight}
			/>
		</Suspense>
	);
});
