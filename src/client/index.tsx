import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ConfigProvider } from './ConfigContext.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

const root = document.getElementById('root');
if (root) {
	createRoot(root).render(
		<ErrorBoundary>
			<ConfigProvider>
				<App />
			</ConfigProvider>
		</ErrorBoundary>,
	);
}
