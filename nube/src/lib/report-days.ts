/** «del 12 al 14 de julio de 2026», «12 de julio de 2026»: a report's days (#505). */
export function daysText(from: string, to: string) {
	const long = (d: string, opts: Intl.DateTimeFormatOptions) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', { ...opts, timeZone: 'UTC' });
	const full = { day: 'numeric', month: 'long', year: 'numeric' } as const;
	if (from === to) return long(from, full);
	if (from.slice(0, 7) === to.slice(0, 7))
		return `del ${Number(from.slice(8))} al ${long(to, full)}`;
	if (from.slice(0, 4) === to.slice(0, 4))
		return `del ${long(from, { day: 'numeric', month: 'long' })} al ${long(to, full)}`;
	return `del ${long(from, full)} al ${long(to, full)}`;
}
