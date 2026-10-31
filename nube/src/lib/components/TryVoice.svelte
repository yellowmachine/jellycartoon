<script lang="ts">
	import { onDestroy } from 'svelte';
	import { music } from 'comun/music-player.svelte.ts';
	import { secondary } from '#lib/styles.ts';

	/**
	 * Oración's voice tried (#339): a few lines read now with this voice and tone, not kept, to hear
	 * it before recording a long text. What plays pauses meanwhile, and goes on after.
	 */
	let {
		voice,
		tone,
		text,
		label = '▶ Probar'
	}: { voice: string; tone: string; text: string; label?: string } = $props();

	let step = $state<'idle' | 'asking' | 'playing'>('idle');
	let problem = $state<string | null>(null);
	let audio: HTMLAudioElement | null = null;
	let url: string | null = null;

	function stop() {
		audio?.pause();
		audio = null;
		if (url) URL.revokeObjectURL(url);
		url = null;
		if (step === 'playing') music.resumeAfterVoice();
		step = 'idle';
	}

	async function play() {
		if (step !== 'idle') return stop();
		problem = null;
		step = 'asking';
		const res = await fetch('/api/oracion/probar', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ voice, tone, text })
		}).catch(() => null);
		if (step !== 'asking') return;
		if (!res?.ok) {
			problem =
				(await res?.json().catch(() => null))?.message ??
				(res ? 'No se pudo probar la voz.' : 'Sin conexión.');
			step = 'idle';
			return;
		}
		url = URL.createObjectURL(await res.blob());
		audio = new Audio(url);
		audio.onended = stop;
		music.pauseForVoice();
		step = 'playing';
		await audio.play().catch(stop);
	}

	onDestroy(stop);
</script>

<span class="inline-flex flex-wrap items-center gap-2">
	<button type="button" class={secondary} disabled={!text.trim()} onclick={play}
		>{step === 'asking' ? 'Generando la prueba…' : step === 'playing' ? '■ Parar' : label}</button
	>
	{#if problem}<span class="text-sm text-red-400">{problem}</span>{/if}
</span>
