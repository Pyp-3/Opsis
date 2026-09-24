/** Why an utterance was refused. */
export type SafetyCategory = 'explicit' | 'violence' | 'self_harm' | 'hate';

type SafetyRule = { category: SafetyCategory; pattern: RegExp };

/**
 * Deliberately small, high-precision patterns: Opsis is for students, so explicit, violent,
 * self-harm and hateful input is refused. Everyday science words ("cells kill bacteria") pass.
 */
const RULES: readonly SafetyRule[] = [
  {
    category: 'explicit',
    pattern: /\b(porn\w*|sexy|nudes?|orgasm\w*|masturbat\w*|erotic\w*|blowjobs?|boobs?|tits)\b/iu,
  },
  { category: 'explicit', pattern: /\b(fuck\w*|shit\w*|bitch\w*|cunt\w*|whore\w*|slut\w*)\b/iu },
  {
    category: 'violence',
    pattern:
      /\b(?:make|build|making|building|how to make)\s+(?:a\s+)?(?:bomb|pipe bomb|explosive|weapon|gun)s?\b/iu,
  },
  {
    category: 'violence',
    pattern:
      /\b(?:kill|murder|stab|shoot|behead|torture)\s+(?:him|her|them|people|someone|my|your|a (?:person|child|kid))\b/iu,
  },
  {
    category: 'self_harm',
    pattern: /\b(?:kill myself|suicide|self[- ]harm|cut myself|hurt myself|end my life)\b/iu,
  },
  { category: 'hate', pattern: /\b(?:nazis? are good|heil hitler|genocide is good)\b/iu },
];

/** Returns the first matching safety category, or null when the utterance is fine to visualise. */
export function checkSafety(utterance: string): SafetyCategory | null {
  return RULES.find((rule) => rule.pattern.test(utterance))?.category ?? null;
}

/** Friendly refusal text for each category; never repeats the offending input. */
export function refusalMessage(category: SafetyCategory): string {
  if (category === 'self_harm') {
    return "Opsis can't draw that, but you don't have to handle hard feelings alone. Please talk to a trusted adult or a local helpline.";
  }
  return "Opsis is for learning, so it can't draw that sentence. Try describing something you'd like to understand, like 'The sun rises in the east.'";
}
