/**
 * Mensajes (#551): one lock for a person's groups, shared by the page and the service worker (Web
 * Locks API): the worker reads a message for its notice while the page may be syncing too.
 */
export function lockFor(userId: string) {
	return <T>(fn: () => Promise<T>): Promise<T> => {
		const locks = (globalThis.navigator as Navigator | undefined)?.locks;
		return locks ? (locks.request(`seilide-mensajes-${userId}`, fn) as Promise<T>) : fn();
	};
}
