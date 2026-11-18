/**
 * The PC's apps (#530) as the service there names them (deploy/jellycartoon-apps.sh): what both the
 * server (server/pc-apps.ts) and the checks of a shortcut's target need, without the socket.
 */

export interface PcApp {
	/** Flatpak's id: «com.ktechpit.red». */
	id: string;
	name: string;
}

/** An app id, as Flatpak names them (the service checks it again, and that it is installed). */
export const isAppId = (text: string) =>
	/^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+){2,}$/.test(text);

/** «<id>\t<name>» per line → the apps, by name. */
export const parseAppList = (text: string): PcApp[] =>
	text
		.split('\n')
		.map((line) => line.split('\t'))
		.filter(([id]) => id && isAppId(id.trim()))
		.map(([id, name]) => ({ id: id!.trim(), name: name?.trim() || id!.trim() }))
		.sort((a, b) => a.name.localeCompare(b.name, 'es'));
