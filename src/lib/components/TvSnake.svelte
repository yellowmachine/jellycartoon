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

<!-- The Nokia 3310's LCD: dark green squares, with a gap between them, on pale green. -->
<div
	class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[#c7f0d8] p-10 font-mono font-bold text-[#43523d]"
	role="application"
	aria-label="La serpiente"
>
	<div
		class="flex w-full max-w-6xl items-baseline justify-between border-b-4 border-[#43523d] pb-2 text-4xl tabular-nums"
	>
		<span>{String(snake.score).padStart(4, '0')}</span>
		<span>Récord {String(record).padStart(4, '0')}</span>
	</div>
	<div class="relative aspect-[24/14] w-full max-w-6xl border-4 border-[#43523d]">
		<span class="absolute flex items-center justify-center" style={cell(...snake.food)}>
			<span class="size-1/2 rotate-45 bg-[#43523d]"></span>
		</span>
		{#each snake.body as [x, y], i (i)}
			<span class="absolute bg-[#43523d] bg-clip-content p-0.5" style={cell(x, y)}></span>
		{/each}
		{#if snake.over || paused}
			<div class="absolute inset-0 flex items-center justify-center">
				<div
					class="flex flex-col items-center gap-3 border-4 border-[#43523d] bg-[#c7f0d8] px-12 py-8 text-center"
				>
					<p class="text-6xl">{snake.over ? 'Fin' : 'Pausa'}</p>
					{#if snake.over}
						<p class="text-3xl">
							{snake.score}
							{snake.score === 1 ? 'manzana' : 'manzanas'}{snake.score && snake.score >= record
								? ' · ¡récord!'
								: ''}
						</p>
					{/if}
					<p class="text-2xl">OK: {snake.over ? 'otra partida' : 'seguir'} · Volver: salir</p>
				</div>
			</div>
		{/if}
	</div>
	<p class="text-2xl opacity-70">Flechas: girar · OK: pausa · Volver: salir</p>
</div>
