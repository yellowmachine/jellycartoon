import { stat } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { dataRoot } from '#lib/server/library/paths.ts';
import { noteSalonUse } from '#lib/server/cinema/inbox.ts';
import { isAppId, parseAppList, type PcApp } from '#lib/pc-apps.ts';

/**
 * The PC's apps (#530), for the TV shortcuts «Aplicación del PC»: the Flatpak apps installed on the
 * PC with the screen (Red, for YouTube on the TV), listed, opened and their icons, by a systemd
 * service there (deploy/jellycartoon-apps.socket), which leaves its socket in the data folder: no
 * setting of its own. Only installed apps: the service checks each id.
 */
const SOCKET = path.join(dataRoot, 'apps.sock');

/** Whether the service is there: its socket. Looked at each time; it is installed apart. */
export async function pcAppsEnabled() {
	return (await stat(SOCKET).catch(() => null))?.isSocket() ?? false;
}

/** A line to the service (deploy/jellycartoon-apps.sh), and all it answers. */
function ask(line: string, timeoutMs = 3000) {
	return new Promise<Buffer>((resolve, reject) => {
		const chunks: Buffer[] = [];
		const socket = net.createConnection(SOCKET, () => socket.end(`${line}\n`));
		socket.setTimeout(timeoutMs, () =>
			socket.destroy(new Error('El servicio de aplicaciones del PC no contesta'))
		);
		socket.on('data', (chunk) => chunks.push(chunk));
		socket.once('error', reject);
		socket.once('close', (failed) => failed || resolve(Buffer.concat(chunks)));
	});
}

/** The apps installed there; none without the service. */
export async function pcApps(): Promise<PcApp[]> {
	if (!(await pcAppsEnabled())) return [];
	return parseAppList((await ask('list')).toString('utf8'));
}

/** Opens it there; throws if the service cannot, or it is not installed. */
export async function openPcApp(id: string) {
	if (!isAppId(id)) throw new Error('No es una aplicación');
	// An app on the TV: Cine's inbox waits (cinema/inbox.ts).
	noteSalonUse('una aplicación del PC');
	const answer = (await ask(`run ${id}`)).toString('utf8').trim();
	if (answer !== 'ok') throw new Error('Esa aplicación ya no está instalada en el PC');
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** Its icon, as Flatpak exports it (a PNG); null if none or no service. */
export async function pcAppIcon(id: string): Promise<Buffer | null> {
	if (!isAppId(id) || !(await pcAppsEnabled())) return null;
	const bytes = await ask(`icon ${id}`, 5000);
	return bytes.subarray(0, 4).equals(PNG) ? bytes : null;
}
