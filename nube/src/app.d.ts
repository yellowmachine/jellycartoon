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
	}
}

export {};
