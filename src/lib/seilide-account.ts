/**
 * Where this person's account is looked after (#279), by how they can enter this house: with
 * Seilide, their password and second step are there. Only the administrator keeps a password here
 * too, for when Seilide does not answer.
 */
export function seilideAccount(providers: string[], nubeUrl: string | null, nubeProvider: string) {
	if (!nubeUrl || !providers.includes(nubeProvider)) return null;
	return {
		url: new URL('/ajustes?seccion=cuenta', nubeUrl).href,
		ownPassword: providers.includes('credential')
	};
}

/** What Better Auth needs of Seilide's answer to verify who comes in. */
export function usableDiscovery(doc: unknown) {
	const d = (doc ?? {}) as Record<string, unknown>;
	return [d.issuer, d.authorization_endpoint, d.token_endpoint, d.jwks_uri].every(
		(v) => typeof v === 'string' && v !== ''
	);
}

export interface SeilideKid {
	email: string;
	name: string;
	avatar: string | null;
	guardians: string[];
}

/** Seilide's children, as it says them (#279): only those with its inner address. */
export function parseSeilideKids(list: unknown): SeilideKid[] {
	return (Array.isArray(list) ? list : []).flatMap((kid) => {
		const k = (kid ?? {}) as Record<string, unknown>;
		if (typeof k.email !== 'string' || !/@peques\.invalid$/i.test(k.email)) return [];
		if (typeof k.name !== 'string') return [];
		return [
			{
				email: k.email.trim().toLowerCase(),
				name: k.name.trim().slice(0, 60) || 'Peque',
				avatar: typeof k.avatar === 'string' ? k.avatar : null,
				guardians: Array.isArray(k.guardians) ? k.guardians.map(String) : []
			}
		];
	});
}
