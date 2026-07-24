// Traduction des erreurs en message utilisateur — utilisé partout où une
// action peut échouer (RPC Supabase, PostgREST, Edge Function).
//
// Principe : le détail technique complet part toujours en console (pour le
// diagnostic support) ; l'utilisateur ne voit jamais un message SQL/Postgres
// brut. Un message métier déjà clair (levé par nos propres triggers/RPC —
// abonnement requis, compte suspendu, limite atteinte…) est affiché tel
// quel ; seule une signature technique reconnue (colonne/relation absente,
// contrainte violée, droit refusé, erreur de syntaxe, cache de schéma…) est
// remplacée par un message générique et clair.
const TECHNICAL_ERROR_PATTERN =
  /does not exist|violates .* constraint|duplicate key value|permission denied for|syntax error|schema cache|invalid input syntax|invalid jwt|unrecognized jwt|jwt kid|jwks|malformed jwt|invalid signature|json web token/i;

function extractMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as { message?: unknown }).message ?? '');
  }
  return '';
}

/**
 * Décrit une erreur pour l'utilisateur : message métier tel quel si
 * disponible et non technique, sinon un message générique construit autour
 * de `context` (ex. "la publication de la mission"). Journalise toujours le
 * détail complet en console.
 */
export function describeError(e: unknown, context: string): string {
  console.error(e);
  const message = extractMessage(e);
  if (message && !TECHNICAL_ERROR_PATTERN.test(message)) return message;
  return `Une erreur technique empêche temporairement ${context}. Réessaie dans un instant, ou contacte le support si ça persiste.`;
}
