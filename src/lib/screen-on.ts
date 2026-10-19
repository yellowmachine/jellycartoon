/**
 * The screen kept on while a page wants it (the road mode, #78), with the browser's Screen Wake
 * Lock: https://developer.mozilla.org/docs/Web/API/Screen_Wake_Lock_API. The browser lets it go
 * when the page is hidden (another app in front, the screen off): it is asked for again when the
 * page is shown. Returns what stops it; `onProblem`, why it cannot, if it cannot.
 */
export function keepScreenOn(onProblem: (text: string | null) => void) {
	if (!('wakeLock' in navigator)) {
		onProblem('Este navegador no puede mantener la pantalla encendida.');
		return () => {};
	}
	let lock: WakeLockSentinel | null = null;
	let stopped = false;

	async function acquire() {
		if (stopped || (lock && !lock.released)) return;
		try {
			lock = await navigator.wakeLock.request('screen');
			onProblem(null);
		} catch {
			// Not visible, or the battery saver says no: asked again when the page is shown.
			if (document.visibilityState === 'visible')
				onProblem('No se pudo mantener la pantalla encendida (¿ahorro de batería?).');
		}
	}

	const shown = () => {
		if (document.visibilityState === 'visible') void acquire();
	};
	document.addEventListener('visibilitychange', shown);
	void acquire();
	return () => {
		stopped = true;
		document.removeEventListener('visibilitychange', shown);
		void lock?.release().catch(() => {});
	};
}
