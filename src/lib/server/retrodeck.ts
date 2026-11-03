import { stat } from 'node:fs/promises';
import net from 'node:net';
import { RETRODECK_SOCKET } from '$app/env/private';

/**
 * GAMES_DIR's games opened in RetroDECK on the PC with the screen, instead of in the browser: by a
 * systemd service there (deploy/jellycartoon-retrodeck.socket), with RetroDECK's own command line.
 * Its saved games and its settings are RetroDECK's, not the app's.
 */

/**
 * Whether games can be opened in RetroDECK: its service's socket is there. Looked at each time,
 * since the setting is given wherever there are games (compose.prod.yaml) and the service only
 * where RetroDECK is installed.
 */
export async function retrodeckEnabled() {
	if (!RETRODECK_SOCKET) return false;
	return (await stat(RETRODECK_SOCKET).catch(() => null))?.isSocket() ?? false;
}

/** Asks the service to open a game: its console's folder and its file in GAMES_DIR. */
export const openInRetrodeck = (system: string, file: string) =>
	tellRetrodeckService(`${system}/${file}`);

/** Only RetroDECK, with no game: its ES-DE, to browse. */
export const openRetrodeck = () => tellRetrodeckService('retrodeck');

/** A line to the service (deploy/jellycartoon-retrodeck.sh). */
function tellRetrodeckService(line: string) {
	return new Promise<void>((resolve, reject) => {
		const socket = net.createConnection(RETRODECK_SOCKET!, () => socket.end(`${line}\n`));
		socket.setTimeout(3000, () =>
			socket.destroy(new Error('El servicio de RetroDECK no contesta'))
		);
		socket.once('error', reject);
		socket.once('close', (failed) => failed || resolve());
	});
}
