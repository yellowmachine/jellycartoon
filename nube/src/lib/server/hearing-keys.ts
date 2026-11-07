/** Failing, the key is asked for again only after this long. */
const RETRY_MS = 60_000;

/**
 * The keys to the houses' Whisper that the satellites were given (#430), by satellite, asked for
 * in the background: what rings is not held up by a house that does not answer. Null until known,
 * and `known` is called once it is. Apart, without the server's modules, to be tested.
 */
export function hearingKeys(
	ask: (familyId: string, satellite: string) => Promise<string>,
	now = Date.now
) {
	const keys = new Map<string, string>();
	const asked = new Map<string, number>();
	return (familyId: string, satellite: string, known: () => void) => {
		const key = keys.get(satellite);
		if (key) return key;
		const last = asked.get(satellite);
		if (last === undefined || now() - last >= RETRY_MS) {
			asked.set(satellite, now());
			ask(familyId, satellite).then(
				(got) => {
					keys.set(satellite, got);
					known();
				},
				(err) => console.warn('[voz] Sin la clave de Whisper de la casa:', String(err))
			);
		}
		return null;
	};
}
