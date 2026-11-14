/**
 * A browser's User-Agent, said briefly for /admin's «Última vez»: «Android · Chrome», «iPhone ·
 * Safari», «Linux · Firefox». Null, nothing known.
 */
export function deviceLabel(userAgent: string | null) {
	if (!userAgent) return null;
	const ua = userAgent;
	const system = /iPhone/.test(ua)
		? 'iPhone'
		: /iPad/.test(ua)
			? 'iPad'
			: /Android/.test(ua)
				? 'Android'
				: /Windows/.test(ua)
					? 'Windows'
					: /Mac OS X|Macintosh/.test(ua)
						? 'Mac'
						: /CrOS/.test(ua)
							? 'ChromeOS'
							: /Linux/.test(ua)
								? 'Linux'
								: null;
	const browser = /Edg\//.test(ua)
		? 'Edge'
		: /Firefox\/|FxiOS/.test(ua)
			? 'Firefox'
			: /SamsungBrowser/.test(ua)
				? 'Samsung'
				: /Chrome\/|CriOS/.test(ua)
					? 'Chrome'
					: /Safari\//.test(ua)
						? 'Safari'
						: null;
	const label = [system, browser].filter(Boolean).join(' · ');
	return label || null;
}
