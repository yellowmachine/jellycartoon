import { APP_VERSION, WUD_PASSWORD, WUD_URL } from '$app/env/private';
import { log } from '#lib/server/log.ts';

/**
 * New versions (#20): the app knows its own (APP_VERSION, from the image), asks GitHub for the
 * latest release, and asks WUD (What's Up Docker), which installs it, to do it now. At night WUD
 * does it on its own.
 */

const REPO = 'yellowmachine/jellycartoon';
/** GitHub is asked at most this often: a release a day is a lot. */
const CHECK_MS = 6 * 3600_000;
/** The name of the trigger in compose.prod.yaml (WUD_TRIGGER_DOCKER_JELLYCARTOON_…). */
const TRIGGER = 'docker/jellycartoon';

export interface Release {
	version: string;
	name: string;
	/**
	 * Its notes, written in Markdown, as HTML made by GitHub itself (and cleaned by it): the
	 * `html` media type, https://docs.github.com/rest/releases/releases#get-the-latest-release
	 */
	notesHtml: string;
	url: string;
}

/** `1.2.0` from `v1.2.0`; null if it is not a version (`dev`, `sha-…`). */
function semver(text: string) {
	const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
	return match ? match.slice(1).map(Number) : null;
}

function newer(a: number[], b: number[]) {
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
	return false;
}

let cached: { at: number; release: Release | null } | null = null;

/**
 * The latest published release (not drafts nor pre-releases); null if GitHub cannot be asked.
 * `fresh` asks GitHub now, and what it says is remembered for the notice on every page.
 */
async function latestRelease(fresh = false): Promise<Release | null> {
	if (!fresh && cached && Date.now() - cached.at < CHECK_MS) return cached.release;
	let release: Release | null = null;
	try {
		const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
			headers: { accept: 'application/vnd.github.html+json' },
			signal: AbortSignal.timeout(10_000)
		});
		// 404: no release yet.
		if (res.ok) {
			const body = await res.json();
			release = {
				version: String(body.tag_name).replace(/^v/, ''),
				name: body.name || body.tag_name,
				notesHtml: body.body_html ?? '',
				url: body.html_url
			};
		} else if (res.status !== 404) {
			log.warn('versiones', `GitHub respondió ${res.status} al buscar la última versión`);
		}
	} catch (error) {
		log.warn('versiones', 'No se pudo preguntar a GitHub por la última versión', { error });
	}
	cached = { at: Date.now(), release };
	return release;
}

/**
 * This version, and the release to update to if there is a newer one. `fresh`: whoever opens
 * Ajustes to check gets GitHub's answer now, not the one from up to six hours ago.
 */
export async function versionInfo({ fresh = false } = {}) {
	const current = semver(APP_VERSION);
	// `sha-…` (the `latest` channel) or `dev`: there are no releases to compare with.
	if (!current)
		return { current: APP_VERSION, release: false as const, update: null, canUpdate: false };
	const latest = await latestRelease(fresh);
	const version = latest && semver(latest.version);
	return {
		current: APP_VERSION,
		release: true as const,
		update: latest && version && newer(version, current) ? latest : null,
		/** With WUD the admin can update from the notice; without it, it is done by hand. */
		canUpdate: Boolean(WUD_URL && WUD_PASSWORD)
	};
}

async function wud(path: string, init: RequestInit = {}) {
	const res = await fetch(new URL(path, WUD_URL), {
		...init,
		headers: {
			authorization: `Basic ${btoa(`admin:${WUD_PASSWORD}`)}`,
			'content-type': 'application/json'
		},
		signal: init.signal ?? AbortSignal.timeout(60_000)
	});
	if (!res.ok) throw new Error(`WUD respondió ${res.status} a ${path}`);
	return res.json();
}

/**
 * Asks WUD to update now. Asked to look, WUD installs on its own what it finds new (its triggers
 * run on their own): firing the trigger as well would update twice at once. So the trigger only goes
 * by hand when WUD already knew of the update and it is still there (the night's one failed or was
 * undone). If there is nothing new yet, `not-ready`: the image of a release takes some minutes to be
 * built after it is published. The update replaces this container, so it is not waited for: the
 * page notices the new version on its own.
 */
export async function startUpdate(): Promise<'started' | 'not-ready'> {
	if (!WUD_URL || !WUD_PASSWORD) throw new Error('No hay WUD configurado (WUD_URL, WUD_PASSWORD)');
	type Container = { id: string; updateAvailable: boolean; labels?: Record<string, string> };
	// The app's service in compose.prod.yaml. Not by hostname: WUD's new container keeps the old one's.
	const app = (containers: Container[]) =>
		containers.find((c) => c.labels?.['com.docker.compose.service'] === 'app');
	const self = app(await wud('/api/containers'));

	if (!self) {
		// WUD starts with the app and may have looked before it was up: until its next look it does
		// not know it. Asked to look at everything now, it also installs on its own what it finds.
		const fresh = app(await wud('/api/containers/watch', { method: 'POST' }));
		if (!fresh) throw new Error('WUD no vigila la app (falta la etiqueta wud.watch=true)');
		if (!fresh.updateAvailable) return 'not-ready';
		log.info('versiones', 'WUD ha encontrado la versión nueva y la está instalando');
		return 'started';
	}

	if (self.updateAvailable) {
		log.info('versiones', 'Actualización pedida a WUD');
		wud(`/api/containers/${self.id}/triggers/${TRIGGER}`, {
			method: 'POST',
			// It ends with this container replaced: no answer is expected.
			signal: AbortSignal.timeout(30 * 60_000)
		}).catch((error) => log.warn('versiones', 'WUD no terminó la actualización', { error }));
		return 'started';
	}
	// Every container, not only the app: what the others have new (Caddy…) is known before the app
	// restarts, for UpdateProgress to wait for it too (`pendingUpdates`).
	const fresh = app(await wud('/api/containers/watch', { method: 'POST' }));
	if (!fresh?.updateAvailable) return 'not-ready';
	log.info('versiones', 'WUD ha encontrado la versión nueva y la está instalando');
	return 'started';
}

/** While an update asked for here goes on, it is not asked for again. */
const UPDATING_MS = 15 * 60_000;
let starting: Promise<'started' | 'not-ready'> | null = null;
let startedAt = 0;

/**
 * `startUpdate`, once: «Actualizar ahora» pressed twice, or from two devices, asked WUD to replace
 * the same container twice at once, and one of the two failed. While a request is on its way, or
 * for UPDATING_MS after one started (the update replaces this process: a new one starts afresh),
 * the same answer and nothing new for WUD.
 */
export function startUpdateOnce() {
	if (Date.now() - startedAt < UPDATING_MS) return Promise.resolve('started' as const);
	starting ??= startUpdate()
		.then((result) => {
			if (result === 'started') startedAt = Date.now();
			return result;
		})
		.finally(() => (starting = null));
	return starting;
}

/**
 * How many containers WUD still has to update: after the app it goes on with the rest (Caddy,
 * Snapcast…), one by one, and while Caddy restarts the browser reaches nothing. Null without WUD
 * or when it does not answer.
 */
export async function pendingUpdates(): Promise<number | null> {
	if (!WUD_URL || !WUD_PASSWORD) return null;
	try {
		const containers: { updateAvailable: boolean }[] = await wud('/api/containers', {
			signal: AbortSignal.timeout(5_000)
		});
		return containers.filter((c) => c.updateAvailable).length;
	} catch (error) {
		log.warn('versiones', 'No se pudo preguntar a WUD qué le queda por actualizar', {
			error: String(error)
		});
		return null;
	}
}
