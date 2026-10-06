/** Phrases that start a request to DO something even when they end in a question mark ("can you add Redis?"). */
const POLITE_REQUEST = /^(?:please|can you|could you|would you|will you|can we|could we|would it be possible|why don't you|how about|why not)\b/i;

/** Words that open a question about the diagram, so it works without a question mark ("is PostgreSQL a single point of failure"). */
const QUESTION_OPENER = /^(?:what|what's|whats|why|how|which|who|where|when|is|are|does|do|did|should|explain|describe|tell me|show me what|summari[sz]e|review|analy[sz]e|list)\b/i;

/** A typed line is advice when it is a question; polite requests and anything else stay commands. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (!t || POLITE_REQUEST.test(t)) return false;
  return t.endsWith('?') || QUESTION_OPENER.test(t);
}
