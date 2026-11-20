import { fetchArcadeGames, type ArcadeGame } from 'comun/fbneo-list.ts';

/**
 * FinalBurn Neo's list (comun's fbneo-list.ts) for «Tus juegos»' arcade folders (#564): fetched
 * the first time a family's bucket has one, and kept in memory (Seilide has no DATA_DIR); a
 * restart fetches it again.
 */
let loading: Promise<Record<string, ArcadeGame>> | null = null;

export function arcadeGames() {
	loading ??= fetchArcadeGames().catch((problem) => {
		// Tried again next time.
		loading = null;
		throw problem;
	});
	return loading;
}
