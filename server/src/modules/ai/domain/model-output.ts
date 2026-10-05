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
