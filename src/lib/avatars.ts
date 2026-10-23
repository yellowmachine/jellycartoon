/**
 * The children's avatars (#141), to choose with the remote in «¿Quién eres?»: fixed, an animal
 * on a colour each, so two children never look alike.
 */
export const AVATARS = [
	{ id: 'zorro', emoji: '🦊', color: 'bg-orange-500' },
	{ id: 'panda', emoji: '🐼', color: 'bg-zinc-200' },
	{ id: 'rana', emoji: '🐸', color: 'bg-green-500' },
	{ id: 'leon', emoji: '🦁', color: 'bg-amber-400' },
	{ id: 'tigre', emoji: '🐯', color: 'bg-yellow-500' },
	{ id: 'koala', emoji: '🐨', color: 'bg-sky-300' },
	{ id: 'conejo', emoji: '🐰', color: 'bg-pink-300' },
	{ id: 'pulpo', emoji: '🐙', color: 'bg-fuchsia-500' },
	{ id: 'unicornio', emoji: '🦄', color: 'bg-violet-400' },
	{ id: 'tortuga', emoji: '🐢', color: 'bg-emerald-400' },
	{ id: 'pinguino', emoji: '🐧', color: 'bg-blue-400' },
	{ id: 'mono', emoji: '🐵', color: 'bg-amber-700' },
	{ id: 'dinosaurio', emoji: '🦖', color: 'bg-lime-500' },
	{ id: 'gato', emoji: '🐱', color: 'bg-rose-400' },
	{ id: 'perro', emoji: '🐶', color: 'bg-yellow-700' },
	{ id: 'buho', emoji: '🦉', color: 'bg-indigo-400' }
] as const;

export type AvatarId = (typeof AVATARS)[number]['id'];

export const isAvatar = (id: unknown): id is AvatarId => AVATARS.some((a) => a.id === id);

/** The avatar with that id, or the first one. */
export const avatar = (id: string | null | undefined) =>
	AVATARS.find((a) => a.id === id) ?? AVATARS[0];

/** How long a parent lets a child in for (#141): this time, a while, or the rest of the day. */
export const PERMITS = [
	{ id: 'once', label: 'Esta vez' },
	{ id: '1h', label: '1 hora' },
	{ id: '2h', label: '2 horas' },
	{ id: 'today', label: 'Hoy' }
] as const;

export type PermitId = (typeof PERMITS)[number]['id'];
