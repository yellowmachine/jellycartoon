/// <reference lib="webworker" />
import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

/**
 * Mensajes (#551): voice notes transcribed in this device, never sent anywhere: Whisper (small, 8-bit,
 * ~240 MB downloaded once from Hugging Face and kept by the browser), in a worker, so the page does
 * not stop. Asked with 16 kHz mono samples; answers with the text, or how the download goes.
 */
export const MODEL = 'onnx-community/whisper-small';

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function load() {
	asr ??= pipeline('automatic-speech-recognition', MODEL, {
		dtype: 'q8',
		progress_callback: (p: { status: string; progress?: number; file?: string }) => {
			if (p.status === 'progress' && typeof p.progress === 'number')
				postMessage({ kind: 'progress', file: p.file, progress: p.progress });
		}
	}) as Promise<AutomaticSpeechRecognitionPipeline>;
	asr.catch(() => (asr = null));
	return asr;
}

onmessage = async (e: MessageEvent<{ id: number; samples: Float32Array }>) => {
	const { id, samples } = e.data;
	try {
		const run = await load();
		postMessage({ kind: 'ready' });
		const out = (await run(samples, {
			language: 'spanish',
			task: 'transcribe',
			chunk_length_s: 30
		})) as {
			text: string;
		};
		postMessage({ kind: 'text', id, text: out.text.trim() });
	} catch (err) {
		postMessage({ kind: 'error', id, message: err instanceof Error ? err.message : String(err) });
	}
};
