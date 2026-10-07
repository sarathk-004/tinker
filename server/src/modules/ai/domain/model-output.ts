import { z } from 'zod';
import { NODE_KINDS } from '@tinker/shared';
import { MAX_PLAN_STEPS, STEP_TYPES, planStepSchema } from './plan.ts';

/**
 * What the model may return. Validated strictly after parsing: unknown fields, unknown step types, too many steps or
 * over-long text all make the output invalid (treated as a provider failure, never executed).
 */
/**
 * Component names and labels written by the model end up in people's diagrams, so they are held to a stricter standard than the engine
 * itself (which allows 120 characters): a short name, no trailing thoughts. The small model sometimes lets its reasoning leak into a
 * field ("Redis ... wait, Redis is fine, let's keep it short"); such an answer is rejected, which makes the gateway retry once.
 */
const SELF_TALK = /\.\.\.|…|\bwait\b|\bhmm+\b|\blet me\b|\blet's\b|\bactually\b|\boops\b|\bi think\b|\bor something\b/i;
export const MODEL_NAME_MAX = 60;
export const MODEL_TECHNOLOGY_MAX = 40;
export const MODEL_RELATIONSHIP_MAX = 40;
function checkModelStep(step: { name?: string | undefined; technology?: string | null | undefined; relationship?: string | undefined }, ctx: z.RefinementCtx): void {
  const bad = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (step.name !== undefined && (step.name.length > MODEL_NAME_MAX || SELF_TALK.test(step.name))) bad('name', 'does not look like a component name');
  if (typeof step.technology === 'string' && SELF_TALK.test(step.technology)) bad('technology', 'does not look like a product name');
  if (step.relationship !== undefined && SELF_TALK.test(step.relationship)) bad('relationship', 'does not look like a label');
}

export const modelOutputSchema = z.strictObject({
  outcome: z.enum(['COMMANDS', 'CLARIFY', 'PROPOSE', 'UNSUPPORTED']),
  /** Short note for the user ("Put Redis between Orders and PostgreSQL"). */
  message: z.string().trim().max(400).optional(),
  question: z.string().trim().max(400).optional(),
  options: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
  commands: z.array(planStepSchema.superRefine(checkModelStep)).max(MAX_PLAN_STEPS).optional(),
});
export type ModelOutput = z.infer<typeof modelOutputSchema>;

/** JSON Schema sent to the provider (a flat subset every structured-output implementation accepts). */
export const MODEL_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    outcome: { type: 'string', enum: ['COMMANDS', 'CLARIFY', 'PROPOSE', 'UNSUPPORTED'] },
    message: { type: 'string' },
    question: { type: 'string' },
    options: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    commands: {
      type: 'array',
      maxItems: MAX_PLAN_STEPS,
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...STEP_TYPES] },
          as: { type: 'string' },
          ref: { type: 'string' },
          name: { type: 'string' },
          kind: { type: 'string', enum: [...NODE_KINDS] },
          technology: { type: 'string' },
          source: { type: 'string' },
          target: { type: 'string' },
          edge: { type: 'string' },
          relationship: { type: 'string' },
        },
        required: ['type'],
      },
    },
  },
  required: ['outcome'],
} as const;

const OPTIONAL_TEXT_LIMITS = { technology: 60, relationship: MODEL_RELATIONSHIP_MAX } as const;
const MAX_USER_TEXT = 400;
const MAX_OPTION = 120;

/**
 * Models sometimes put a paragraph in an optional descriptive field. Those fields are decoration, so an over-long value is
 * DROPPED rather than failing the whole plan (a retry costs seconds). Everything that matters (types, aliases, names, kinds)
 * stays strictly validated afterwards. Returns the input unchanged when it is not the expected shape.
 */
/**
 * The small, fast model occasionally keeps "talking" after a sentence and glues stray text (even fragments of the prompt) straight onto
 * the question mark: `What would you like to improve?ptorsttpsn1: n1 -> n2`. Real text has a space after `?` or `!`, so everything from
 * a `?` or `!` that is followed directly by another character is cut. Full-width marks (？ ！) are normalised first.
 */
export function cutGluedJunk(text: string): string {
  const normalised = text.replace(/？/g, '?').replace(/！/g, '!');
  const glued = /[?!](?=[^\s"'”’)\]?!.,;:])/u.exec(normalised);
  return glued ? normalised.slice(0, glued.index + 1) : normalised;
}

export function dropOverlongOptionalFields(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const out = { ...(raw as Record<string, unknown>) };

  // Words meant for the user (the question, the note, the buttons): empty ones are dropped, over-long ones are shortened. Neither is
  // worth failing the whole answer over, and neither can change what an edit does.
  for (const field of ['question', 'message'] as const) {
    const value = out[field];
    if (typeof value !== 'string') continue;
    let text = cutGluedJunk(value).trim();
    // A question is one question: whatever the model keeps saying after the first "?" is dropped (it is where the rambling happens).
    if (field === 'question') text = text.slice(0, text.indexOf('?') >= 0 ? text.indexOf('?') + 1 : undefined);
    if (text.length === 0) delete out[field];
    else out[field] = text.length > MAX_USER_TEXT ? `${text.slice(0, MAX_USER_TEXT - 1).trimEnd()}…` : text;
  }
  if (Array.isArray(out['options'])) {
    out['options'] = (out['options'] as unknown[])
      .filter((o): o is string => typeof o === 'string' && cutGluedJunk(o).trim().length > 0)
      .map((o) => cutGluedJunk(o).trim())
      .map((o) => (o.length > MAX_OPTION ? `${o.slice(0, MAX_OPTION - 1).trimEnd()}…` : o))
      .slice(0, 6);
  }

  if (Array.isArray(out['commands'])) {
    out['commands'] = (out['commands'] as unknown[]).map((step) => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) return step;
      const copy = { ...(step as Record<string, unknown>) };
      // A model often fills a field it has nothing for with "": that means "not given", never "an empty name".
      for (const [field, value] of Object.entries(copy)) if (typeof value === 'string' && value.trim().length === 0) delete copy[field];
      for (const [field, max] of Object.entries(OPTIONAL_TEXT_LIMITS)) {
        const value = copy[field];
        if (typeof value === 'string' && value.trim().length > max) delete copy[field];
      }
      return copy;
    });
  }
  return out;
}
