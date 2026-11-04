import { sql, type SQLWrapper } from 'drizzle-orm';

/** Lowercase and without accents, in SQL: «Café» finds «cafe». No extension (unaccent) needed. */
export const plain = (value: SQLWrapper | string) =>
	sql`translate(lower(${value}), 'áàäâéèëêíìïîóòöôúùüûñç', 'aaaaeeeeiiiioooouuuunc')`;

/** A pattern for `like` that finds `text` as it is, wherever it is. */
export const likeOf = (text: string) =>
	`%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The same, here: for what was found in the database, to say where. */
export const plainText = (text: string) =>
	text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
