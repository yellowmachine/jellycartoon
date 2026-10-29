/** The house's snapserver a satellite plays from (#296), as written in Ajustes. */

/**
 * A snapserver's address as written: a name or an IPv4, and its port if not 1704. Null if empty;
 * undefined if it is not one.
 */
export function parseSnapserver(value: string): string | null | undefined {
	const clean = value.trim().toLowerCase();
	if (!clean) return null;
	const match =
		/^([a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)(:(\d{1,5}))?$/.exec(clean);
	if (!match) return undefined;
	const port = match[6] ? Number(match[6]) : null;
	if (port !== null && (port < 1 || port > 65_535)) return undefined;
	return clean;
}
