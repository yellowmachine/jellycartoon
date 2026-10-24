/**
 * Routes' maps for a device without coverage (#164): what the server and the pages share. The work
 * itself: route-maps.ts on the server, route-maps.svelte.ts on the device.
 */

export type RouteMapState = 'pending' | 'downloading' | 'ready' | 'failed' | 'remove';

/** A route's map that a device keeps whole. */
export interface HeldMap {
	routeId: number;
	version: string;
	bytes: number;
}

export interface DeviceOrder {
	routeId: number;
	action: 'download' | 'remove';
}

/** What the device says of one; `removed`, it is gone from it. */
export interface RouteMapReport {
	routeId: number;
	state: Exclude<RouteMapState, 'pending' | 'remove'> | 'removed';
	progress?: number;
	bytes?: number;
	version?: string;
	problem?: string;
}

export interface RouteMapsView {
	/** There is Spain's map to cut them from. */
	map: boolean;
	devices: { id: string; name: string; lastSeenAt: Date }[];
	maps: {
		routeId: number;
		deviceId: string;
		state: RouteMapState;
		progress: number;
		bytes: number | null;
		problem: string | null;
		/** Cut from a map or a way that changed since. */
		old: boolean;
		updatedAt: Date;
	}[];
}

export const MAX_DEVICE_NAME = 40;

/** A device's id, as it makes it (crypto.randomUUID). */
export const isDeviceId = (value: unknown): value is string =>
	typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);

/** In MB, as people read it: `74 MB`, `1,2 GB`. */
export function sizeText(bytes: number) {
	const mb = bytes / 1_000_000;
	return mb >= 1000
		? `${(mb / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} GB`
		: `${Math.max(1, Math.round(mb))} MB`;
}
