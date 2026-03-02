import { type RefObject, memo } from 'react';

interface SearchOverlayProps {
	query: string;
	onQueryChange: (query: string) => void;
	matchCount: number;
	currentMatch: number;
	onNext: () => void;
	onPrev: () => void;
	onClose: () => void;
	inputRef: RefObject<HTMLInputElement | null>;
	isLoadingAll?: boolean;
}

export const SearchOverlay = memo(function SearchOverlay({
	query,
	onQueryChange,
	matchCount,
	currentMatch,
	onNext,
	onPrev,
	onClose,
	inputRef,
	isLoadingAll = false,
}: SearchOverlayProps) {
	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (e.shiftKey) onPrev();
			else onNext();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		} else if (e.key === 'F3') {
			e.preventDefault();
			if (e.shiftKey) onPrev();
			else onNext();
		}
	};

	const statusText = isLoadingAll
		? 'Loading...'
		: query.trim()
			? `${matchCount > 0 ? currentMatch + 1 : 0} of ${matchCount}`
			: '';

	return (
		<div className="search-overlay">
			<input
				ref={inputRef as React.RefObject<HTMLInputElement>}
				type="text"
				className="search-overlay-input"
				placeholder="Search transcript..."
				value={query}
				onChange={(e) => onQueryChange(e.target.value)}
				onKeyDown={handleKeyDown}
			/>
			{statusText && <span className="search-overlay-count">{statusText}</span>}
			<button
				type="button"
				className="search-overlay-btn"
				onClick={onPrev}
				disabled={matchCount === 0}
				title="Previous (Shift+Enter)"
			>
				&#x2191;
			</button>
			<button
				type="button"
				className="search-overlay-btn"
				onClick={onNext}
				disabled={matchCount === 0}
				title="Next (Enter)"
			>
				&#x2193;
			</button>
			<button
				type="button"
				className="search-overlay-btn search-overlay-close"
				onClick={onClose}
				title="Close (Escape)"
			>
				&#x2715;
			</button>
		</div>
	);
});
