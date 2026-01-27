import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
	children: ReactNode;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

/**
 * Error boundary to catch rendering errors and show a fallback UI
 * instead of a white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		console.error('Orbit UI Error:', error, errorInfo);
	}

	handleReload = (): void => {
		window.location.reload();
	};

	render(): ReactNode {
		if (this.state.hasError) {
			return (
				<div className="error-boundary">
					<h1>Something went wrong</h1>
					<p className="error-message">{this.state.error?.message || 'Unknown error'}</p>
					<button type="button" onClick={this.handleReload}>
						Reload Page
					</button>
					<details>
						<summary>Error Details</summary>
						<pre>{this.state.error?.stack}</pre>
					</details>
				</div>
			);
		}

		return this.props.children;
	}
}
