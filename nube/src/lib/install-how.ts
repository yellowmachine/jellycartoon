/** Which browser this is, and what to tap in each to install Seilide (InstallApp). */

export type BrowserId =
	| 'ios'
	| 'android-chrome'
	| 'android-samsung'
	| 'android-firefox'
	| 'pc-chromium'
	| 'pc-firefox'
	| 'mac-safari';

/** What to tap in each browser, as it reads in Spanish. */
export const HOW: { id: BrowserId; name: string; steps: string }[] = [
	{
		id: 'ios',
		name: 'iPhone y iPad',
		steps: 'Toca el botón Compartir y luego «Añadir a pantalla de inicio».'
	},
	{
		id: 'android-chrome',
		name: 'Android con Chrome, Brave o Edge',
		steps: 'En el menú (⋮), «Instalar aplicación» o «Añadir a pantalla de inicio».'
	},
	{
		id: 'android-samsung',
		name: 'Android con Samsung Internet',
		steps: 'En el menú (≡), «Añadir página a» → «Pantalla de inicio».'
	},
	{
		id: 'android-firefox',
		name: 'Android con Firefox',
		steps: 'En el menú (⋮), «Añadir a pantalla de inicio».'
	},
	{
		id: 'pc-chromium',
		name: 'PC con Chrome, Brave o Edge',
		steps:
			'El icono de instalar a la derecha de la barra de direcciones, o en el menú del navegador, «Instalar Seilide».'
	},
	{
		id: 'mac-safari',
		name: 'Mac con Safari',
		steps: 'En el menú Archivo, «Añadir al Dock».'
	},
	{
		id: 'pc-firefox',
		name: 'PC con Firefox',
		steps: 'Firefox no instala webs en el ordenador: ábrela en Chrome, Brave o Edge.'
	}
];

/** This browser, from its user agent: only to choose which steps to show first. */
export function browserOf(ua: string, touchPoints = 0): BrowserId {
	// iPadOS says it is a Mac, but a Mac has no touch screen.
	if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'ios';
	if (/Android/.test(ua)) {
		if (/SamsungBrowser/.test(ua)) return 'android-samsung';
		if (/Firefox/.test(ua)) return 'android-firefox';
		return 'android-chrome';
	}
	if (/Firefox/.test(ua)) return 'pc-firefox';
	if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua))
		return 'mac-safari';
	return 'pc-chromium';
}
