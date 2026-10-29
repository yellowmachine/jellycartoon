/**
 * What a voice satellite says while the AI thinks (#223), one a line in Ajustes → Casa. Short: they
 * fill a wait, they are not an answer.
 */

export {
	DEFAULT_FILLERS,
	DEFAULT_TONE,
	MAX_FILLER_CHARS,
	MAX_FILLERS,
	MAX_TONE_CHARS,
	parseFillers,
	pickFiller
} from 'comun/ai-voice.ts';

/** A phrase recorded by the AI voice: how it was asked to say it, and when. */
export interface FillerRecording {
	tone: string;
	at: string;
}
