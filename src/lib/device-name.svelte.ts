/**
 * This device's name (Ajustes), as the music queue says where it was playing: «Sonaba en el
 * salón». Written as it is shown, article and all. In the browser, like the Música background.
 */

const KEY = 'jellycartoon:device-name';

/** As long as the queue keeps it (parseQueueSave). */
export const DEVICE_NAME_MAX = 50;

function stored() {
	try {
		return localStorage.getItem(KEY) ?? '';
	} catch {
		return '';
	}
}

class DeviceName {
	value = $state(typeof window === 'undefined' ? '' : stored());

	set(value: string) {
		this.value = value.slice(0, DEVICE_NAME_MAX);
		try {
			if (this.value.trim()) localStorage.setItem(KEY, this.value);
			else localStorage.removeItem(KEY);
		} catch {
			// Private window: it is only forgotten.
		}
	}
}

export const deviceName = new DeviceName();

/** The name given to it or, without one, what it is: «la TV», «el móvil», «el ordenador». */
export function shownDeviceName(tv: boolean) {
	const name = deviceName.value.trim();
	if (name) return name;
	if (tv) return 'la TV';
	return matchMedia('(pointer: coarse)').matches ? 'el móvil' : 'el ordenador';
}
