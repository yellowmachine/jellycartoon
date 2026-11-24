/** What the key has spent: all its life, this month and this week; null if it cannot be asked. */
export async function keyUsage(apiKey: string) {
	try {
		const res = await fetch('https://openrouter.ai/api/v1/key', {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(10_000)
		});
		if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
		const { data } = await res.json();
		return {
			total: data.usage ?? 0,
			month: data.usage_monthly ?? 0,
			week: data.usage_weekly ?? 0
		};
	} catch (error) {
		console.warn('[ia] No se pudo consultar el gasto en OpenRouter', String(error));
		return null;
	}
}
