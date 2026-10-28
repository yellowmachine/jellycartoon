import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';
import { DATABASE_URL } from '$app/env/private';

if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = postgres(DATABASE_URL, { onnotice: () => {} });

/**
 * As the app's role, to which row-level security applies: the families' tables give nothing
 * outside `withFamily` (family.ts). Better Auth's tables have none.
 */
export const db = drizzle(client, { schema });

export type Db = typeof db;
