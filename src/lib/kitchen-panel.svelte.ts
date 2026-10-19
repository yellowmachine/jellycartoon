/**
 * The kitchen panel (#60): /voz's microphone, recipe and session, opened over the page that is on
 * instead of going to /voz, so that a video there (the news) goes on playing. Opened and closed
 * from the header's «Modo cocina»: one tap from the kitchen to the video and back.
 */
class KitchenPanel {
	open = $state(false);

	show() {
		this.open = true;
		// A video in full screen would hide it.
		if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
	}

	hide() {
		this.open = false;
	}

	toggle() {
		if (this.open) this.hide();
		else this.show();
	}
}

export const kitchenPanel = new KitchenPanel();
