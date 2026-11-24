/**
 * The children's avatars (#141), to choose with the remote in «¿Quién eres?»: fixed, an animal
 * on a colour each, so two children never look alike. The same in every theme (light ones too).
 */
export const AVATARS = [
	{ id: 'zorro', emoji: '🦊', color: 'bg-[#f97316]' },
	{ id: 'panda', emoji: '🐼', color: 'bg-[#e4e4e7]' },
	{ id: 'rana', emoji: '🐸', color: 'bg-[#22c55e]' },
	{ id: 'leon', emoji: '🦁', color: 'bg-[#fbbf24]' },
	{ id: 'tigre', emoji: '🐯', color: 'bg-[#eab308]' },
	{ id: 'koala', emoji: '🐨', color: 'bg-[#7dd3fc]' },
	{ id: 'conejo', emoji: '🐰', color: 'bg-[#f9a8d4]' },
	{ id: 'pulpo', emoji: '🐙', color: 'bg-[#d946ef]' },
	{ id: 'unicornio', emoji: '🦄', color: 'bg-[#a78bfa]' },
	{ id: 'tortuga', emoji: '🐢', color: 'bg-[#34d399]' },
	{ id: 'pinguino', emoji: '🐧', color: 'bg-[#60a5fa]' },
	{ id: 'mono', emoji: '🐵', color: 'bg-[#b45309]' },
	{ id: 'dinosaurio', emoji: '🦖', color: 'bg-[#84cc16]' },
	{ id: 'gato', emoji: '🐱', color: 'bg-[#fb7185]' },
	{ id: 'perro', emoji: '🐶', color: 'bg-[#a16207]' },
	{ id: 'buho', emoji: '🦉', color: 'bg-[#818cf8]' }
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
