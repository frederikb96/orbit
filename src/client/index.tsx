import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

const root = document.getElementById('root');
if (root) {
	createRoot(root).render(
		<ErrorBoundary>
			<App />
		</ErrorBoundary>,
	);
}
