import type { auth } from '#lib/server/auth.ts';

type User = typeof auth.$Infer.Session.user;
type Session = typeof auth.$Infer.Session.session;

// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Locals {
			user?: User;
			session?: Session;
		}
		interface PageState {
			/** The locked Vista's extra entry (#532): Android's back takes it, not the app. */
			vistaGuard?: boolean;
			/** Preguntar's sheet open over the page, on a phone: back closes it. */
			chatSheet?: boolean;
		}
	}
}

export {};
