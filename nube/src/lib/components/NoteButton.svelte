<script lang="ts">
	import { noteRecorder as recorder } from '#lib/note-recorder.svelte.ts';
	import { clockText } from '#lib/walks.ts';

	/** Tapped, it records a note (#416); tapped again, it stops, and `onrecorded` has it. */
	let { onrecorded, class: className = '' }: { onrecorded: (a: Blob) => void; class?: string } =
		$props();
</script>

<button
	type="button"
	class={[className, recorder.recording && 'animate-pulse']}
	onclick={() => (recorder.recording ? recorder.stop() : recorder.start(onrecorded))}
>
	{recorder.recording ? `⏹ Parar ${clockText(recorder.seconds)}` : '🎙️ Nota'}
</button>
