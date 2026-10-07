import { z } from 'zod';
import { MAX_PLAN_STEPS, planStepSchema } from '../domain/plan.ts';

/** The buttons offered with a proposal. Typing either word works the same: they are ordinary replies. */
export const YES_OPTION = 'Yes, add it';
export const NO_OPTION = 'No, leave it as it is';

const YES = new Set([
  'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'confirm', 'go ahead', 'do it', 'please do', 'yes please', 'yes do it', 'yes add it',
  'add it', 'sounds good', 'that works', 'yes go ahead', 'yes confirm', 'yes please do', 'ok do it', 'okay do it', 'sure do it', 'sure go ahead',
]);
const NO = new Set([
  'no', 'nope', 'nah', 'cancel', 'never mind', 'nevermind', 'no thanks', 'no thank you', 'dont', 'dont do it', 'stop', 'leave it', 'leave it as it is',
  'no leave it as it is', 'no leave it', 'no never mind', 'no cancel', 'no dont', 'no stop',
]);

/**
 * Exactly the short replies that mean yes or no. Anything longer ("no, add Redis instead") is a new request and is handled as one,
 * never mistaken for a cancel. Exact matching on purpose: a reply that merely STARTS with "yes" must not apply a stored plan.
 */
export function classifyReply(text: string): 'YES' | 'NO' | null {
  const t = text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (YES.has(t)) return 'YES';
  if (NO.has(t)) return 'NO';
  return null;
}

/** What the server keeps with its own question, so that "yes" applies exactly what was asked about (never anything the client sends). */
export const storedProposalSchema = z.object({
  status: z.literal('PROPOSAL'),
  proposal: z.object({
    source: z.enum(['PARSER', 'AI']),
    /** The diagram version the plan was made against: aliases (n1, n2...) mean the same components only at that version. */
    diagramVersion: z.number().int().min(1),
    steps: z.array(planStepSchema).min(1).max(MAX_PLAN_STEPS),
  }),
});
export type StoredProposal = z.infer<typeof storedProposalSchema>['proposal'];

export function readProposal(metadata: unknown): StoredProposal | null {
  const parsed = storedProposalSchema.safeParse(metadata);
  return parsed.success ? parsed.data.proposal : null;
}
