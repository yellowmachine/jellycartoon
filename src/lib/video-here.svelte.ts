/**
 * The video playing in this browser's player (an episode, or a channel live), for voice commands:
 * the microphone in the header pauses it while someone speaks (so Whisper does not hear the
 * episode) and tells the server what it is and where, so «manda los últimos 5 minutos a Langua»
 * ends right there. A kitchen timer that rings pauses it too, and the kitchen panel shows it.
 */

interface VideoHere {
	/** Null for a channel live: no episode to send to Langua. */
	episodeId: number | null;
	/** «Friends · El de la boda», «La 1»: for the kitchen panel. */
	title: string;
	element: HTMLVideoElement;
	/** It goes on elsewhere (Snapcast, #223): it stops, and no longer saves where it goes. */
	handOver?: () => void;
}

class VideoHereState {
	current = $state<VideoHere | null>(null);
	/** As the <video> says: for the kitchen panel's button. */
	playing = $state(false);
	/** Paused by the microphone: played again once the answer has been read. */
	#pausedByVoice = false;
	#stopListening: (() => void) | null = null;

	set(video: VideoHere) {
		this.#stopListening?.();
		this.current = video;
		const el = video.element;
		const update = () => (this.playing = !el.paused);
		update();
		el.addEventListener('play', update);
		el.addEventListener('pause', update);
		this.#stopListening = () => {
			el.removeEventListener('play', update);
			el.removeEventListener('pause', update);
		};
	}

	/** Only if it is still this one: the next episode may have taken its place. */
	clear(element: HTMLVideoElement) {
		if (this.current?.element !== element) return;
		this.#stopListening?.();
		this.#stopListening = null;
		this.current = null;
		this.playing = false;
	}

	/** Tapped in the kitchen panel. */
	toggle() {
		const element = this.current?.element;
		if (!element) return;
		this.#pausedByVoice = false;
		if (element.paused) element.play().catch(() => {});
		else element.pause();
	}

	/** For the server: what episode plays here and where, if one does. */
	position() {
		const video = this.current;
		return video?.episodeId != null && video.element.currentTime > 0
			? { episodeId: video.episodeId, positionSec: video.element.currentTime }
			: null;
	}

	pauseForVoice() {
		const element = this.current?.element;
		if (!element || element.paused) return;
		element.pause();
		this.#pausedByVoice = true;
	}

	resumeAfterVoice() {
		if (!this.#pausedByVoice) return;
		this.#pausedByVoice = false;
		this.current?.element.play().catch(() => {});
	}

	/** By voice, it goes on elsewhere: stopped here. */
	handOver() {
		this.#pausedByVoice = false;
		this.current?.handOver?.();
	}

	/** What was said moved on to something else (another episode): it stays paused. */
	forgetPause() {
		this.#pausedByVoice = false;
	}
}

export const videoHere = new VideoHereState();
