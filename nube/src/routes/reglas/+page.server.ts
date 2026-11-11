import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { withFamily } from '#lib/server/family.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { forgetLearned, listLearned } from '#lib/server/voice/learned.ts';
import { editMemory, forget, listMemories, remember } from '#lib/server/memory.ts';
import { RULE_TEMPLATES } from '#lib/rule-templates.ts';
import { NO_IFS, WEATHER_IFS, type WhatIf } from '#lib/server/rule-sim.ts';
import {
	deleteRule,
	listRules,
	saveRule,
	setRulePaused,
	simulateRules,
	translateCost,
	translateRule,
	tryRule
} from '#lib/server/rules.ts';

/**
 * «Reglas» (#331, #389) and what the voice remembers, out of Ajustes into their own page: they had
 * grown past a setting. Children never get here: kids.ts does not let them in (neither the page nor
 * its actions).
 */

/** «¿Qué pasaría…?»'s «y si…» (#389, phase 2), from its form: what is not known, as it is. */
function ifsOf(form: FormData): WhatIf {
	const weather = String(form.get('ifWeather') ?? '');
	const doses = String(form.get('ifDoses') ?? '');
	const kind = String(form.get('ifKind') ?? '');
	const text = String(form.get('ifText') ?? '')
		.trim()
		.slice(0, 200);
	return {
		weather: (WEATHER_IFS as readonly string[]).includes(weather)
			? (weather as WhatIf['weather'])
			: NO_IFS.weather,
		away: form.get('ifAway') === 'on',
		doses: doses === 'sin_marcar' || doses === 'marcadas' ? doses : NO_IFS.doses,
		happens:
			text && (kind === 'dicho' || kind === 'nevera' || kind === 'recuerdo' || kind === 'compra')
				? { kind, text }
				: null
	};
}

export const load: PageServerLoad = async ({ locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const admin = await withFamily(locals.user!.id, async (_, m) => m.role === 'admin');
	const rules = await listRules(k, locals.user!.id);
	return {
		/** What the voice remembers: theirs (no one else sees it) and the house's. */
		memories: await listMemories(k, locals.user!.id, true),
		/** What the voice learned from its questions, by place (learned.ts): its administrator. */
		voiceLearned: admin ? await listLearned(k) : null,
		/** «¿Qué pasaría…?» (#389): about what understanding a rule written to try costs; streamed. */
		ruleDraftCost: translateCost(k).catch(() => null),
		/** Rules ready to turn on (#331, phase 7), and whether they have each one on. */
		ruleTemplates: RULE_TEMPLATES.map((t) => ({
			id: t.id,
			title: t.title,
			does: t.does,
			on: rules.some((r) => r.userId === locals.user!.id && r.spec.template === t.id)
		})),
		/** Their rules and the house's (#331): as understood, and the last time each told. */
		rules: rules.map((r) => ({
			id: r.id,
			mine: Boolean(r.userId),
			said: r.said,
			understood: r.understood,
			paused: r.paused,
			aloud: r.spec.then !== 'temporizador' && (r.spec.say ?? !r.userId),
			timer: r.spec.then === 'temporizador' && r.spec.timer ? r.spec.timer : null,
			lastFiredAt: r.lastFiredAt,
			lastWhy: r.lastWhy
		}))
	};
};

export const actions: Actions = {
	/** «Lo que la voz recuerda»: one more, theirs or the house's. */
	addMemory: async ({ request, locals }) => {
		const form = await request.formData();
		const text = String(form.get('text') ?? '');
		if (!text.trim()) return fail(400, { memoryProblem: 'Escribe qué tiene que recordar' });
		await remember(
			await kitchenOf(locals.user!.id),
			form.get('whose') === 'house' ? null : locals.user!.id,
			text,
			{ untilDay: String(form.get('until') ?? '') || null }
		);
		return { saved: 'memory' };
	},
	/** One changed: its words and its last day (theirs, or the house's). */
	editMemory: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const text = String(form.get('text') ?? '');
		if (!Number.isInteger(id) || !text.trim())
			return fail(400, { memoryProblem: 'Escribe qué tiene que recordar' });
		await editMemory(
			await kitchenOf(locals.user!.id),
			locals.user!.id,
			id,
			text,
			String(form.get('until') ?? '') || null
		);
		return { saved: 'memory' };
	},
	/** And one forgotten: theirs, or the house's. */
	forgetMemory: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (Number.isInteger(id)) await forget(await kitchenOf(locals.user!.id), locals.user!.id, id);
		return { saved: 'memory' };
	},
	/** One of «Costumbres de la voz», forgotten: only its administrator. */
	forgetVoiceLearned: async ({ request, locals }) => {
		const admin = await withFamily(locals.user!.id, async (_, m) => m.role === 'admin');
		if (!admin) return fail(403, { memoryProblem: 'Solo quien administra la familia' });
		const id = Number((await request.formData()).get('id'));
		if (Number.isInteger(id)) await forgetLearned(await kitchenOf(locals.user!.id), id);
		return { saved: 'voiceLearned' };
	},
	/** «Reglas» (#331): a new one, or (with `id`) one said again, understood by the AI. */
	saveRule: async ({ request, locals }) => {
		const form = await request.formData();
		const said = String(form.get('text') ?? '');
		const id = form.get('id') ? Number(form.get('id')) : null;
		if (!said.trim()) return fail(400, { ruleProblem: 'Escribe la regla', ruleId: id });
		const k = await kitchenOf(locals.user!.id);
		const made = await translateRule(k, said, locals.user!.name);
		if ('problem' in made) return fail(400, { ruleProblem: made.problem, ruleId: id });
		const whose = form.get('whose') === 'house' ? null : locals.user!.id;
		const saved = await saveRule(
			k,
			id === null ? whose : locals.user!.id,
			said,
			made.understood,
			made.spec,
			Number.isInteger(id) ? id : null
		);
		if (!saved)
			return fail(400, { ruleProblem: 'Ya hay demasiadas reglas en la familia', ruleId: id });
		return { saved: 'rule', ruleId: saved };
	},
	/** One ready (#331, phase 7), turned on: its rules, theirs. */
	activateTemplate: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		const template = RULE_TEMPLATES.find((t) => t.id === id);
		if (!template) return fail(400, { ruleProblem: 'Esa regla lista no existe', ruleId: null });
		const k = await kitchenOf(locals.user!.id);
		for (const r of template.rules)
			if (!(await saveRule(k, locals.user!.id, r.said, r.understood, { ...r.spec, template: id })))
				return fail(400, { ruleProblem: 'Ya hay demasiadas reglas en la familia', ruleId: null });
		return { saved: 'rule' };
	},
	/** «Pausar» and «Seguir». */
	pauseRule: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (Number.isInteger(id))
			await setRulePaused(
				await kitchenOf(locals.user!.id),
				locals.user!.id,
				id,
				form.get('paused') === 'true'
			);
		return { saved: 'rule' };
	},
	/** «Probar»: what it would do now. */
	tryRule: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		const said = Number.isInteger(id)
			? await tryRule(await kitchenOf(locals.user!.id), locals.user!.id, id)
			: null;
		return { ruleTried: { id, said: said ?? 'Esa regla ya no está.' } };
	},
	/** «¿Qué pasaría…?» (#389): the rules on a day to come, with nothing told nor kept. */
	simulateRules: async ({ request, locals }) => {
		const form = await request.formData();
		const asked = {
			day: String(form.get('day') ?? ''),
			time: String(form.get('time') ?? ''),
			wholeDay: form.get('span') === 'dia',
			draft: String(form.get('draft') ?? ''),
			draftHouse: form.get('whose') === 'house',
			ai: form.get('ai') === '1',
			ifs: ifsOf(form)
		};
		const result = await simulateRules(
			await kitchenOf(locals.user!.id),
			locals.user!.id,
			locals.user!.name,
			asked
		);
		if ('problem' in result) return fail(400, { simulation: { asked, problem: result.problem } });
		return { simulation: { asked, ...result } };
	},
	deleteRule: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (Number.isInteger(id))
			await deleteRule(await kitchenOf(locals.user!.id), locals.user!.id, id);
		return { saved: 'rule' };
	}
};
