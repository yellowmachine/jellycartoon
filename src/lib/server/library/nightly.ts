import { setLastScan } from '#lib/server/app-settings.ts';
import { scanCinema } from '#lib/server/cinema/scan.ts';
import { log } from '#lib/server/log.ts';
import { msUntilHour } from '#lib/schedule.ts';
import { cinemaRoot } from './paths.ts';
import { scanLibrary } from './scan.ts';

/**
 * Every night at this hour (server time), the series and films folders are scanned: what was
 * added is converted while nobody uses the PC, and gets its subtitles if Gestión asks for them.
 * In the app rather than a cron of the host, so every house with the image has it.
 */
export const NIGHTLY_SCAN_HOUR = 3;

/** The series folder, scanned, and how it went kept for Gestión: at night or by its button. */
export async function scanSeries() {
	const result = await scanLibrary();
	await setLastScan('series', result);
	return result;
}

/** The same for films: at night or by Cine's button. */
export async function scanFilms() {
	const result = await scanCinema();
	await setLastScan('films', { ...result, discs: result.discs.length });
	return result;
}

let started = false;

export function startNightlyScan() {
	if (started) return;
	started = true;
	const schedule = () => setTimeout(run, msUntilHour(NIGHTLY_SCAN_HOUR)).unref();
	async function run() {
		log.info('scan', 'Escaneo nocturno');
		await scanSeries().catch((error) =>
			log.error('scan', 'Falló el escaneo nocturno de series', { error })
		);
		if (cinemaRoot)
			await scanFilms().catch((error) =>
				log.error('cine', 'Falló el escaneo nocturno de películas', { error })
			);
		schedule();
	}
	schedule();
}
