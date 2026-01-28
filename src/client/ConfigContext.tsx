import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { DEFAULT_UI_CONFIG } from '../shared/defaults.ts';
import type { UIConfig } from '../types.ts';

interface ConfigContextValue {
	config: UIConfig;
	loading: boolean;
}

const ConfigContext = createContext<ConfigContextValue>({
	config: DEFAULT_UI_CONFIG,
	loading: true,
});

export function ConfigProvider({ children }: { children: ReactNode }) {
	const [config, setConfig] = useState<UIConfig>(DEFAULT_UI_CONFIG);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		fetch('/api/config')
			.then((res) => {
				if (res.ok) return res.json();
				throw new Error('Failed to fetch config');
			})
			.then((data: UIConfig) => {
				setConfig(data);
				setLoading(false);
			})
			.catch(() => {
				setLoading(false);
			});
	}, []);

	return <ConfigContext.Provider value={{ config, loading }}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigContextValue {
	return useContext(ConfigContext);
}
