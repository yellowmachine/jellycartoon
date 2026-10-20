import type { auth } from '#lib/server/auth.ts';

/** With the plugins' fields, e.g. the admin plugin's `role`. */
type User = typeof auth.$Infer.Session.user;
type Session = typeof auth.$Infer.Session.session;

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			user?: User;
			session?: Session;
		}

		// interface Error {}
		// interface PageData {}
		/** Shallow routing (pushState): what opens over a page, closed by «back». */
		interface PageState {
			/** The TV view's hidden snake (6 1 1 0 on the remote). */
			snake?: boolean;
		}
		// interface Platform {}
	}
}

export {};
