<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import jsQR from 'jsqr';

	/**
	 * «Leer el QR de un peque» (#303): the camera, until it sees the QR on a child's device («¿Quién
	 * eres?»), which opens its request to answer (/peques/permiso/…). Only Seilide's own links: any
	 * other QR is said, not followed. Read here with jsQR, frame by frame, on every browser.
	 */
	let video = $state<HTMLVideoElement>();
	let problem = $state<string | null>(null);
	let wrong = $state(false);

	const REQUEST_PATH = /^\/peques\/permiso\/[\w-]+$/;

	/** Its path, if the text is a link to a request of this Seilide; null otherwise. */
	function requestPath(text: string) {
		try {
			const url = new URL(text);
			return url.origin === location.origin && REQUEST_PATH.test(url.pathname)
				? url.pathname
				: null;
		} catch {
			return null;
		}
	}

	onMount(() => {
		let stream: MediaStream | null = null;
		let frame = 0;
		let stopped = false;
		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d', { willReadFrequently: true });

		function look() {
			if (stopped || !video || !context) return;
			if (video.readyState >= video.HAVE_ENOUGH_DATA) {
				canvas.width = video.videoWidth;
				canvas.height = video.videoHeight;
				context.drawImage(video, 0, 0);
				const image = context.getImageData(0, 0, canvas.width, canvas.height);
				const found = jsQR(image.data, image.width, image.height, {
					inversionAttempts: 'dontInvert'
				});
				if (found) {
					const path = requestPath(found.data);
					if (path) {
						stopped = true;
						void goto(path);
						return;
					}
					wrong = true;
				}
			}
			frame = requestAnimationFrame(look);
		}

		(async () => {
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: 'environment' },
					audio: false
				});
				if (stopped || !video) return stream.getTracks().forEach((t) => t.stop());
				video.srcObject = stream;
				await video.play();
				frame = requestAnimationFrame(look);
			} catch {
				problem =
					'No se puede abrir la cámara. Dale permiso en el navegador, o lee el QR con la cámara del móvil.';
			}
		})();

		return () => {
			stopped = true;
			cancelAnimationFrame(frame);
			stream?.getTracks().forEach((t) => t.stop());
		};
	});
</script>

<svelte:head>
	<title>Leer el QR de un peque · Seilide</title>
</svelte:head>

<div class="mx-auto flex max-w-md flex-col items-center gap-4 pt-6 text-center">
	<h1 class="text-2xl font-bold">Leer el QR de un peque</h1>
	<p class="text-sm text-zinc-400">Apunta al QR que sale en su aparato cuando elige su dibujo.</p>
	{#if problem}
		<p class="text-red-400">{problem}</p>
	{:else}
		<video
			bind:this={video}
			playsinline
			muted
			class="aspect-square w-full max-w-sm rounded-xl bg-zinc-900 object-cover"
		></video>
		{#if wrong}
			<p class="text-sm text-amber-400">Ese QR no es el de un peque de Seilide.</p>
		{/if}
	{/if}
	<a href="/" class="text-zinc-400 hover:text-white">Cancelar</a>
</div>
