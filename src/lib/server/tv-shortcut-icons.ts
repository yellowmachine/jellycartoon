import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataRoot } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { findSiteIcon } from '#lib/server/site-icon.ts';
import { setShortcutIcon } from '#lib/server/tv-shortcuts.ts';

/**
 * The TV shortcuts' icons (#327), from each site (site-icon.ts), kept in DATA_DIR/accesos: the TV
 * draws them from home, not from the site. Each file named anew, so a new one is not the cached one.
 */
const DIR = path.join(dataRoot, 'accesos');

/** Its file, only a name made here: nothing outside the folder. */
export function iconFile(name: string) {
	return /^\d+-\d+\.(png|jpg|webp)$/.test(name) ? path.join(DIR, name) : null;
}

export async function deleteIconFile(name: string | null) {
	const file = name && iconFile(name);
	if (file) await rm(file, { force: true });
}

/**
 * Looks for the site's icon and keeps it: whether there was one. Not finding it (the site lets no
 * server in, or has none big enough) leaves the one it had, and is only logged.
 */
export async function refreshShortcutIcon(id: number, url: string) {
	const icon = await findSiteIcon(url).catch((error) => {
		log.warn('accesos', 'No se pudo leer el icono de la web', { url, error });
		return null;
	});
	if (!icon) return false;
	await mkdir(DIR, { recursive: true });
	const name = `${id}-${Date.now()}.${icon.kind}`;
	await writeFile(path.join(DIR, name), icon.bytes);
	await deleteIconFile(await setShortcutIcon(id, name));
	return true;
}
