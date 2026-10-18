/**
 * The episode playing in this browser's player, for voice commands: the microphone in the header
 * pauses it while someone speaks (so Whisper does not hear the episode) and tells the server what
 * it is and where, so «manda los últimos 5 minutos a Langua» ends right there.
 */

interface VideoHere {
	episodeId: number;
	element: HTMLVideoElement;
}

class VideoHereState {
	current = $state<VideoHere | null>(null);
	/** Paused by the microphone: played again once the answer has been read. */
	#pausedByVoice = false;

	set(video: VideoHere) {
		this.current = video;
	}

	/** Only if it is still this one: the next episode may have taken its place. */
	clear(element: HTMLVideoElement) {
		if (this.current?.element === element) this.current = null;
	}

	/** For the server: what plays here and where, if anything does. */
	position() {
		const video = this.current;
		return video && video.element.currentTime > 0
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

	/** What was said moved on to something else (another episode): it stays paused. */
	forgetPause() {
		this.#pausedByVoice = false;
	}
}

export const videoHere = new VideoHereState();
