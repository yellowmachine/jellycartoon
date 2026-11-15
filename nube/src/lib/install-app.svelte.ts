/**
 * Installing Seilide as an app: the browser's own offer when it makes one (Chrome, Brave, Edge,
 * Samsung Internet: `beforeinstallprompt`), and otherwise what to tap in this browser. The offer
 * comes once, early on the page's load, so the layout listens from the start and any page asks
 * here later.
 */

import { browserOf, type BrowserId } from './install-how.ts';

export { HOW } from './install-how.ts';

type InstallOffer = Event & { prompt: () => Promise<void> };

class InstallApp {
	/** The browser's offer, kept to be shown on a tap. */
	offer = $state<InstallOffer | null>(null);
	/** Opened as an app already: nothing to say. True until known, so nothing flashes. */
	installed = $state(true);
	browser = $state<BrowserId>('pc-chromium');

	/** From the layout, once: listens for the offer and for the install itself. */
	watch() {
		this.installed =
			matchMedia('(display-mode: standalone)').matches ||
			(navigator as Navigator & { standalone?: boolean }).standalone === true;
		this.browser = browserOf(navigator.userAgent, navigator.maxTouchPoints);
		const keep = (e: Event) => {
			e.preventDefault();
			this.offer = e as InstallOffer;
		};
		const done = () => {
			this.offer = null;
			this.installed = true;
		};
		addEventListener('beforeinstallprompt', keep);
		addEventListener('appinstalled', done);
		return () => {
			removeEventListener('beforeinstallprompt', keep);
			removeEventListener('appinstalled', done);
		};
	}

	/** The browser's own dialog; it can be shown only once. */
	async prompt() {
		const offer = this.offer;
		this.offer = null;
		await offer?.prompt();
	}
}

export const installApp = new InstallApp();
