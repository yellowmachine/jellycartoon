/**
 * What happens to each table when an adult leaves their family (#315), unlinked or on their own:
 * they become a family of one and take what is theirs; and what of it goes in their zip. The one
 * list of it, for the move and the zip; a table not here fails person-data.test.ts, so a new one
 * cannot be left behind unnoticed.
 *
 * - `moves`: their rows go with them, as they are.
 * - `onlyTheirsOrCopy`: what is only theirs goes with them; shared with others, they get a copy.
 * - `onlyTheirsOrStays`: what is only theirs goes with them; shared with others, it stays.
 * - `copies`: they get a copy; the original stays.
 * - `dropped`: their rows are deleted, as they mean nothing in the new family.
 * - `stays`: the family's; their rows stay, and they do not take them.
 * - `person`: who they are: a new row in the new family; the old family keeps them as a person
 *   without an account, or forgets the membership.
 * - `account`: of the account, of no family: nothing to move.
 */
/** Where a paper's file is kept (papers.ts): here so as not to need all that papers.ts brings. */
export const PAPERS_AREA_NAME = 'papeles';

export type Leaving =
	| 'moves'
	| 'onlyTheirsOrCopy'
	| 'onlyTheirsOrStays'
	| 'copies'
	| 'dropped'
	| 'stays'
	| 'person'
	| 'account';

/** Which rows go in the zip: those that meet any of these. Columns by their name in the schema. */
export type ZipWhere =
	| { column: string; is: 'me' | 'myPerson' }
	/** Its value among that column's in the rows the zip took of that table. */
	| { column: string; among: { table: string; column: string } };

export interface InZip {
	/** `datos/<file>.json`. */
	file: string;
	where: ZipWhere[];
	/** Its columns sealed with the family key: opened for the zip. */
	sealed?: string[];
	/** Its file in the family's storage, by a column of the row. */
	stored?: { area: string; column: string; suffix?: string; sealed?: boolean };
	/** Of those rows, not this one's: another's private, seen by no one else. */
	hiddenIf?: { column: string; notMine: string };
}

export interface PersonData {
	leaving: Leaving;
	/**
	 * In their zip: all that is personal and what they wrote in what is shared, nothing of others.
	 * False: of no one in particular, of others, or not for reading (keys, tokens).
	 */
	zip: InZip | false;
	/** What the rule alone does not say. */
	note?: string;
}

const mine = (column = 'userId'): ZipWhere => ({ column, is: 'me' });
const forMe = (column = 'personId'): ZipWhere => ({ column, is: 'myPerson' });
const among = (column: string, table: string, theirColumn: string): ZipWhere => ({
	column,
	among: { table, column: theirColumn }
});

export const PERSON_DATA: Record<string, PersonData> = {
	// Who they are.
	family_member: {
		leaving: 'person',
		zip: { file: 'mis-ajustes', where: [mine()] },
		note: 'Their own settings go to the new row'
	},
	family_person: {
		leaving: 'person',
		zip: { file: 'mi-persona', where: [mine()] },
		note: 'The old row stays, with user_id null'
	},

	// Agenda.
	calendar_event: {
		leaving: 'onlyTheirsOrCopy',
		zip: { file: 'citas', where: [mine(), among('id', 'calendar_event_person', 'eventId')] },
		note: 'By calendar_event_person'
	},
	calendar_event_person: {
		leaving: 'onlyTheirsOrCopy',
		zip: { file: 'citas-personas', where: [forMe()] },
		note: 'Follows its event'
	},
	alarm: {
		leaving: 'onlyTheirsOrCopy',
		zip: { file: 'alarmas', where: [mine(), among('id', 'alarm_person', 'alarmId')] },
		note: 'By alarm_person'
	},
	alarm_person: {
		leaving: 'onlyTheirsOrCopy',
		zip: { file: 'alarmas-personas', where: [forMe()] },
		note: 'Follows its alarm'
	},
	agenda_link: {
		leaving: 'stays',
		zip: false,
		note: 'The family calendar link'
	},
	push_subscription: {
		leaving: 'moves',
		zip: false,
		note: 'Their phones keep getting notices'
	},

	// Medication: by whom it is for (person_id), not by who wrote it down.
	medication: {
		leaving: 'moves',
		zip: { file: 'medicacion', where: [forMe()] },
		note: 'By person_id'
	},
	medication_dose: {
		leaving: 'moves',
		zip: { file: 'medicacion-tomas', where: [among('medicationId', 'medication', 'id')] },
		note: 'Follows its medication'
	},

	// Papeles: sealed with the family key, so what leaves is sealed again with the new one.
	paper: {
		leaving: 'onlyTheirsOrCopy',
		zip: {
			file: 'papeles',
			where: [mine(), among('id', 'paper_person', 'paperId')],
			sealed: ['name', 'notes'],
			stored: { area: 'papeles', column: 'file', sealed: true }
		},
		note: 'By paper_person. Sealed again, its file too'
	},
	paper_person: {
		leaving: 'onlyTheirsOrCopy',
		zip: { file: 'papeles-personas', where: [forMe()] },
		note: 'Follows its paper'
	},
	paper_event: {
		leaving: 'onlyTheirsOrCopy',
		zip: { file: 'papeles-citas', where: [among('paperId', 'paper', 'id')] },
		note: 'Only if its event goes too'
	},
	family_data_key: {
		leaving: 'stays',
		zip: false,
		note: 'The new family gets its own'
	},

	// Trips and the road.
	trip: {
		leaving: 'moves',
		zip: { file: 'viajes', where: [mine()] },
		note: 'car_id empty unless the car goes too'
	},
	trip_photo: {
		leaving: 'moves',
		zip: {
			file: 'viajes-fotos',
			where: [mine()],
			stored: { area: 'fotos', column: 'id', suffix: '.jpg' }
		},
		note: 'Its file too'
	},
	saved_place: {
		leaving: 'moves',
		zip: { file: 'lugares', where: [mine()] }
	},
	saved_route: {
		leaving: 'moves',
		zip: { file: 'rutas', where: [mine()] }
	},
	route_map: {
		leaving: 'dropped',
		zip: false,
		note: 'Its route leaves and its device stays'
	},
	map_device: {
		leaving: 'stays',
		zip: false,
		note: 'The car tablet; a phone registers again'
	},
	offline_list: {
		leaving: 'stays',
		zip: false,
		note: 'A playlist of the house on a device'
	},
	car: {
		leaving: 'onlyTheirsOrStays',
		zip: { file: 'coche', where: [among('id', 'car_driver', 'carId')] },
		note: 'Goes if they are its only driver'
	},
	car_driver: {
		leaving: 'onlyTheirsOrStays',
		zip: { file: 'coche-conductor', where: [mine()] },
		note: 'Follows its car; deleted if it stays'
	},
	planned_trip: {
		leaving: 'onlyTheirsOrCopy',
		zip: {
			file: 'viajes-planificados',
			where: [mine(), among('id', 'planned_trip_person', 'tripId')],
			hiddenIf: { column: 'private', notMine: 'userId' }
		},
		note: 'By planned_trip_person'
	},
	planned_trip_person: {
		leaving: 'onlyTheirsOrCopy',
		zip: { file: 'viajes-planificados-personas', where: [forMe()] },
		note: 'Follows its trip'
	},
	planned_leg: {
		leaving: 'onlyTheirsOrCopy',
		zip: { file: 'viajes-planificados-tramos', where: [among('tripId', 'planned_trip', 'id')] },
		note: 'Follows its trip'
	},

	// Walks and notes.
	walk: {
		leaving: 'moves',
		zip: { file: 'paseos', where: [mine()] }
	},
	walk_photo: {
		leaving: 'moves',
		zip: { file: 'paseos-fotos', where: [mine()], stored: { area: 'paseos', column: 'file' } },
		note: 'Its file too'
	},
	note: {
		leaving: 'moves',
		zip: { file: 'notas', where: [mine()], stored: { area: 'notas', column: 'audio' } },
		note: 'Its audio too'
	},

	// The voice: only rows with their user_id; null is the whole house's.
	memory: {
		leaving: 'moves',
		zip: { file: 'recuerdos', where: [mine()] },
		note: 'Only with their user_id'
	},
	rule: {
		leaving: 'moves',
		zip: { file: 'reglas', where: [mine()] },
		note: 'Only with their user_id'
	},
	heard: {
		leaving: 'moves',
		zip: { file: 'dicho-a-la-voz', where: [mine()] },
		note: 'Only with their user_id'
	},
	inbox: {
		leaving: 'moves',
		zip: { file: 'buzon', where: [mine()] },
		note: 'from_user_id empty: the sender stays behind'
	},
	voice_learned: {
		leaving: 'stays',
		zip: false
	},
	voice_satellite: {
		leaving: 'stays',
		zip: false
	},

	// Podcasts: followed person by person from the family's catalogue.
	podcast: {
		leaving: 'copies',
		zip: { file: 'podcasts', where: [among('id', 'podcast_subscription', 'podcastId')] },
		note: 'Those they follow'
	},
	podcast_episode: {
		leaving: 'copies',
		zip: { file: 'podcasts-episodios', where: [among('id', 'podcast_progress', 'episodeId')] },
		note: 'Of those they follow'
	},
	podcast_subscription: {
		leaving: 'moves',
		zip: { file: 'podcasts-seguidos', where: [mine()] },
		note: 'Pointing at the copied podcast'
	},
	podcast_progress: {
		leaving: 'moves',
		zip: { file: 'podcasts-progreso', where: [mine()] },
		note: 'Pointing at the copied episode'
	},

	// Money.
	expense: {
		leaving: 'stays',
		zip: { file: 'gastos', where: [mine()], stored: { area: 'gastos', column: 'receipt' } }
	},
	expense_line: {
		leaving: 'stays',
		zip: { file: 'gastos-lineas', where: [among('expenseId', 'expense', 'id')] }
	},
	expense_favorite: {
		leaving: 'stays',
		zip: { file: 'gastos-favoritos', where: [mine()] }
	},
	recurring_expense: {
		leaving: 'stays',
		zip: { file: 'gastos-fijos', where: [mine()] }
	},
	income: {
		leaving: 'stays',
		zip: { file: 'ingresos', where: [mine()], stored: { area: 'ingresos', column: 'document' } }
	},
	recurring_income: {
		leaving: 'stays',
		zip: { file: 'ingresos-fijos', where: [mine()] }
	},
	bill: {
		leaving: 'stays',
		zip: { file: 'facturas', where: [among('expenseId', 'expense', 'id')] }
	},
	ai_cost: {
		leaving: 'stays',
		zip: false
	},

	// Kitchen.
	fridge_note: {
		leaving: 'stays',
		zip: { file: 'nevera-notas', where: [mine()] }
	},
	fridge_item: {
		leaving: 'stays',
		zip: { file: 'nevera-lista', where: [mine()] }
	},
	recipe: {
		leaving: 'stays',
		zip: { file: 'recetas', where: [mine('createdBy')] }
	},
	recipe_site: {
		leaving: 'stays',
		zip: { file: 'recetas-sitios', where: [mine('createdBy')] }
	},
	recipe_site_page: {
		leaving: 'stays',
		zip: false
	},
	recipe_site_sitemap: {
		leaving: 'stays',
		zip: false
	},

	// Prayer.
	prayer: {
		leaving: 'stays',
		zip: {
			file: 'oraciones',
			where: [mine('createdBy')],
			stored: { area: 'oracion', column: 'audioFile' }
		}
	},
	prayer_voice: {
		leaving: 'stays',
		zip: false
	},
	prayer_list: {
		leaving: 'stays',
		zip: false
	},
	prayer_list_item: {
		leaving: 'stays',
		zip: false
	},

	// Children: theirs stay in the family.
	homework: {
		leaving: 'stays',
		zip: false
	},
	kid_account: {
		leaving: 'stays',
		zip: false
	},
	kid_guardian: {
		leaving: 'dropped',
		zip: false,
		note: 'Where they are the guardian'
	},
	kid_permit: {
		leaving: 'stays',
		zip: false
	},
	kid_login_request: {
		leaving: 'stays',
		zip: false
	},
	trusted_device: {
		leaving: 'stays',
		zip: false
	},

	// The family's own things.
	family_settings: {
		leaving: 'stays',
		zip: false,
		note: 'The new family starts with the defaults'
	},
	house: {
		leaving: 'stays',
		zip: false
	},
	house_key: {
		leaving: 'stays',
		zip: false
	},
	telegram_bot: {
		leaving: 'stays',
		zip: false
	},
	invitation: {
		leaving: 'stays',
		zip: false
	},

	// The account: it is the same one.
	session: {
		leaving: 'account',
		zip: false
	},
	account: {
		leaving: 'account',
		zip: false
	},
	two_factor: {
		leaving: 'account',
		zip: false
	},
	oauth_client: {
		leaving: 'account',
		zip: false,
		note: "A house's client: its family's"
	},
	oauth_consent: {
		leaving: 'account',
		zip: false,
		note: "Revoked: the house is the old family's"
	},
	oauth_access_token: {
		leaving: 'account',
		zip: false,
		note: "Revoked: the house is the old family's"
	},
	oauth_refresh_token: {
		leaving: 'account',
		zip: false,
		note: "Revoked: the house is the old family's"
	}
};
