<script lang="ts">
	import { tick } from 'svelte';

	interface Entry {
		id: number | string;
		role: 'user' | 'assistant';
		content: string;
		sources: { url: string; title: string }[];
		error?: string;
	}

	let { movieId, history }: { movieId: number; history: Entry[] } = $props();

	// Starts from what was saved; then it lives here.
	// svelte-ignore state_referenced_locally
	let entries = $state<Entry[]>(history);
	let question = $state('');
	let asking = $state(false);
	let list: HTMLElement | undefined = $state();

	const SUGGESTIONS = [
		'¿Cómo se hizo?',
		'Háblame de su estilo visual',
		'¿Qué contexto tiene en su época?',
		'Cuéntame alguna curiosidad'
	];

	async function send(text = question) {
		text = text.trim();
		if (!text || asking) return;
		question = '';
		asking = true;
		entries.push({ id: `q${Date.now()}`, role: 'user', content: text, sources: [] });
		entries.push({ id: `a${Date.now()}`, role: 'assistant', content: '', sources: [] });
		const answer = entries[entries.length - 1];
		await tick();
		list?.lastElementChild?.previousElementSibling?.scrollIntoView({ behavior: 'smooth' });

		try {
			const res = await fetch(`/api/cine/${movieId}/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ question: text })
			});
			if (!res.ok || !res.body) throw new Error((await res.text()) || res.statusText);
			let buffer = '';
			for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
				buffer += chunk;
				const lines = buffer.split('\n');
				buffer = lines.pop()!;
				for (const line of lines.filter(Boolean)) {
					const event = JSON.parse(line);
					if (event.text) answer.content += event.text;
					if (event.sources) answer.sources.push(...event.sources);
					if (event.error) answer.error = event.error;
				}
			}
		} catch (err) {
			answer.error = err instanceof Error ? err.message : String(err);
		} finally {
			asking = false;
		}
	}

	/** The server ends the answer, keeping what it said so far. */
	const stop = () => fetch(`/api/cine/${movieId}/chat`, { method: 'PATCH' });

	async function clear() {
		await fetch(`/api/cine/${movieId}/chat`, { method: 'DELETE' });
		entries = [];
	}
</script>

<section class="mt-8 max-w-3xl border-t border-zinc-800 pt-4">
	<div class="mb-3 flex items-center justify-between gap-3">
		<h2 class="font-semibold">Pregúntale</h2>
		{#if entries.length}
			<button onclick={clear} class="text-xs text-zinc-400 hover:text-white hover:underline">
				Empezar de nuevo
			</button>
		{/if}
	</div>

	{#if entries.length === 0}
		<p class="mb-3 text-sm text-zinc-400">
			Pregunta lo que quieras sobre la película: cómo se hizo, su estilo, su época… Se basa en sus
			artículos de Wikipedia y no te desvela el final si aún no la has visto.
		</p>
		<div class="mb-3 flex flex-wrap gap-2">
			{#each SUGGESTIONS as suggestion (suggestion)}
				<button
					onclick={() => send(suggestion)}
					class="rounded-full border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900"
					>{suggestion}</button
				>
			{/each}
		</div>
	{/if}

	<ol bind:this={list} class="space-y-4">
		{#each entries as entry (entry.id)}
			<li class={entry.role === 'user' ? 'flex justify-end' : ''}>
				{#if entry.role === 'user'}
					<p class="max-w-[85%] rounded-lg bg-zinc-800 px-3 py-2 whitespace-pre-line">
						{entry.content}
					</p>
				{:else}
					{#if entry.content}
						<p class="leading-relaxed whitespace-pre-line text-zinc-200">{entry.content}</p>
					{:else if !entry.error}
						<p class="text-sm text-zinc-400">Pensando…</p>
					{/if}
					{#if entry.sources.length}
						<p class="mt-2 flex flex-wrap gap-x-3 text-xs text-zinc-500">
							Fuentes:
							{#each entry.sources as source (source.url)}
								<a href={source.url} target="_blank" rel="noreferrer" class="hover:underline"
									>{source.title}</a
								>
							{/each}
						</p>
					{/if}
					{#if entry.error}
						<p class="text-sm break-words text-red-400">No ha podido responder: {entry.error}</p>
					{/if}
				{/if}
			</li>
		{/each}
	</ol>

	<form
		onsubmit={(e) => {
			e.preventDefault();
			send();
		}}
		class="mt-4 flex items-end gap-2"
	>
		<textarea
			bind:value={question}
			onkeydown={(e) => {
				// Enter sends; Shift+Enter is a new line.
				if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
					e.preventDefault();
					send();
				}
			}}
			rows="2"
			maxlength="2000"
			placeholder="Escribe o dicta con el micrófono del teclado"
			aria-label="Pregunta sobre la película"
			class="min-w-0 flex-1 resize-y rounded-md border-zinc-700 bg-zinc-900 text-sm"></textarea>
		{#if asking}
			<button
				type="button"
				onclick={stop}
				class="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900">Parar</button
			>
		{:else}
			<button
				disabled={!question.trim()}
				class="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
				>Enviar</button
			>
		{/if}
	</form>
</section>
