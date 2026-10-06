import { z } from 'zod';
import { NODE_KINDS } from '@tinker/shared';
import { MAX_PLAN_STEPS, STEP_TYPES, planStepSchema } from './plan.ts';

/**
 * What the model may return. Validated strictly after parsing: unknown fields, unknown step types, too many steps or
 * over-long text all make the output invalid (treated as a provider failure, never executed).
 */
export const modelOutputSchema = z.strictObject({
  outcome: z.enum(['COMMANDS', 'CLARIFY', 'UNSUPPORTED']),
  /** Short note for the user ("Put Redis between Orders and PostgreSQL"). */
  message: z.string().trim().max(400).optional(),
  question: z.string().trim().max(400).optional(),
  options: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
  commands: z.array(planStepSchema).max(MAX_PLAN_STEPS).optional(),
});
export type ModelOutput = z.infer<typeof modelOutputSchema>;

/** JSON Schema sent to the provider (a flat subset every structured-output implementation accepts). */
export const MODEL_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    outcome: { type: 'string', enum: ['COMMANDS', 'CLARIFY', 'UNSUPPORTED'] },
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

const OPTIONAL_TEXT_LIMITS = { technology: 120, relationship: 120 } as const;

/**
 * Models sometimes put a paragraph in an optional descriptive field. Those fields are decoration, so an over-long value is
 * DROPPED rather than failing the whole plan (a retry costs seconds). Everything that matters (types, aliases, names, kinds)
 * stays strictly validated afterwards. Returns the input unchanged when it is not the expected shape.
 */
export function dropOverlongOptionalFields(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const out = raw as { commands?: unknown };
  if (!Array.isArray(out.commands)) return raw;
  return {
    ...(raw as Record<string, unknown>),
    commands: out.commands.map((step) => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) return step;
      const copy = { ...(step as Record<string, unknown>) };
      for (const [field, max] of Object.entries(OPTIONAL_TEXT_LIMITS)) {
        const value = copy[field];
        if (typeof value === 'string' && (value.trim().length === 0 || value.trim().length > max)) delete copy[field];
      }
      return copy;
    }),
  };
}
