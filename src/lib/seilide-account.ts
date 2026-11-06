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
