<script lang="ts">
	import NoteIcon from '#lib/components/NoteIcon.svelte';
	import { noteRecorder as recorder } from '#lib/note-recorder.svelte.ts';
	import { clockText } from '#lib/walks.ts';

	/** Tapped, it records a note (#416); tapped again, it stops, and `onrecorded` has it. */
	let { onrecorded, class: className = '' }: { onrecorded: (a: Blob) => void; class?: string } =
		$props();
</script>

<button
	type="button"
	class={['inline-flex items-center gap-2', className, recorder.recording && 'animate-pulse']}
	onclick={() => (recorder.recording ? recorder.stop() : recorder.start(onrecorded))}
>
	{#if recorder.recording}
		<NoteIcon name="parar" class="h-5 w-5" />Parar {clockText(recorder.seconds)}
	{:else}
		<NoteIcon name="voz" class="h-5 w-5" />Nota
	{/if}
</button>
