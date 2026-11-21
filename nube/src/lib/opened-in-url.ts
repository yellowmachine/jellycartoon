import { replaceState } from '$app/navigation';
import { page } from '$app/state';

/**
 * The thing a page opened in place (a trip, a walk), kept in its address as `?name=id` (none when
 * closed), without navigating: so Preguntar's panel beside it knows what is open (chat-opened.ts),
 * and the address opens it again. SvelteKit's shallow routing.
 */
export function openedInUrl(name: string, id: number | null) {
	const url = new URL(page.url.href);
	if (id === null) url.searchParams.delete(name);
	else url.searchParams.set(name, String(id));
	if (url.href !== page.url.href) replaceState(url, page.state);
}
