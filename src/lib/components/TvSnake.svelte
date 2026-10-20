<script lang="ts">
	import {
		COLS,
		newSnake,
		ROWS,
		step,
		stepMs,
		turn,
		type Direction,
		type Snake
	} from '#lib/snake.ts';

	/**
	 * The snake, hidden over the TV view: 6 1 1 0 on the remote opens it. The arrows turn,
	 * OK pauses or starts again, Back closes it (it is a step in the history: the remote's Back is
	 * the browser's). The record, kept on this TV.
	 */

	const RECORD_KEY = 'jellycartoon:serpiente';
	const ARROWS: Record<string, Direction> = {
		ArrowUp: 'up',
		ArrowDown: 'down',
		ArrowLeft: 'left',
		ArrowRight: 'right'
	};

	let snake = $state<Snake>(newSnake(Math.random));
	let paused = $state(false);
	let record = $state(0);
	try {
		record = Number(localStorage.getItem(RECORD_KEY)) || 0;
	} catch {
		// Without storage: a record for this time only.
	}

	$effect(() => {
		if (snake.over || paused) return;
		const timer = setTimeout(() => (snake = step(snake, Math.random)), stepMs(snake.score));
		return () => clearTimeout(timer);
	});

	$effect(() => {
		if (snake.score <= record) return;
		record = snake.score;
		try {
			localStorage.setItem(RECORD_KEY, String(record));
		} catch {
			// Same.
		}
	});

	/** Before the TV view's own keys and Chromium's spatial navigation: the arrows are the game's. */
	function key(e: KeyboardEvent) {
		const direction = ARROWS[e.key];
		if (direction) {
			e.preventDefault();
			e.stopPropagation();
			if (!paused) snake = turn(snake, direction);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			if (snake.over) snake = newSnake(Math.random);
			else paused = !paused;
		} else if (e.key === 'Escape' || e.key === 'Backspace') {
			// A keyboard's «back»: out, as the remote's Back (the browser's) does by itself.
			e.preventDefault();
			e.stopPropagation();
			history.back();
		} else if (/^\d$/.test(e.key)) {
			e.stopPropagation();
		} else if (e.key === 'F8' || e.key === 'F9') {
			// Play/Pause or the microphone do theirs; the game waits meanwhile.
			paused = true;
		}
	}

	const cell = (x: number, y: number) =>
		`left:${(x / COLS) * 100}%;top:${(y / ROWS) * 100}%;width:${100 / COLS}%;height:${100 / ROWS}%`;
</script>

<svelte:window onkeydowncapture={key} />

<div
	class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-zinc-950 p-10"
	role="application"
	aria-label="La serpiente"
>
	<div class="flex w-full max-w-6xl items-baseline justify-between text-3xl">
		<span class="font-bold text-lime-300">La serpiente</span>
		<span class="tabular-nums">Manzanas: {snake.score} · Récord: {record}</span>
	</div>
	<div
		class="relative aspect-[24/14] w-full max-w-6xl rounded-xl border-4 border-lime-400/60 bg-lime-950/40"
	>
		<span class="absolute rounded-full bg-red-500" style={cell(...snake.food)}></span>
		{#each snake.body as [x, y], i (i)}
			<span
				class={['absolute rounded-md', i === 0 ? 'bg-lime-300' : 'bg-lime-500']}
				style={cell(x, y)}
			></span>
		{/each}
		{#if snake.over || paused}
			<div
				class="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-zinc-950/70 text-center"
			>
				<p class="text-6xl font-bold">{snake.over ? '¡Fin!' : 'En pausa'}</p>
				<p class="text-3xl text-zinc-300">
					{snake.over
						? `${snake.score} ${snake.score === 1 ? 'manzana' : 'manzanas'}${snake.score && snake.score >= record ? ' · ¡récord!' : ''}`
						: ''}
				</p>
				<p class="text-2xl text-zinc-400">
					OK: {snake.over ? 'otra partida' : 'seguir'} · Volver: salir
				</p>
			</div>
		{/if}
	</div>
	<p class="text-2xl text-zinc-500">Flechas: girar · OK: pausa · Volver: salir</p>
</div>
