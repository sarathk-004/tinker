/** Phrases that start a request to DO something even when they end in a question mark ("can you add Redis?"). */
const POLITE_REQUEST = /^(?:please|can you|could you|would you|will you|can we|could we|would it be possible|why don't you|how about)\b/i;

/** A typed line is advice when it is a question; polite requests and anything else stay commands. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  return t.endsWith('?') && !POLITE_REQUEST.test(t);
}
