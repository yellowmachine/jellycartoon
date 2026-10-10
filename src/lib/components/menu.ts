import type { SubmitFunction } from '$app/forms';

/** One row of an ActionMenu: a link, a button or a form's button. */
export const menuItem = 'block w-full rounded px-3 py-1.5 text-left hover:bg-zinc-800';

/** For a menu form's `use:enhance`: updates the page with the result, then closes the menu. */
export const closeAfter =
	(close: () => void): SubmitFunction =>
	() =>
	async ({ update }) => {
		await update();
		close();
	};
