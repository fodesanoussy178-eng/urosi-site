// Edge Function `import-api-engagement` — conservée pour compatibilité.
//
// L'import API Engagement fait désormais partie de l'agent de découverte
// (`mission-agent`) : même code, même journal, limité ici à la source
// `api_engagement`. Préférer `mission-agent` pour tout nouvel appel.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createAgentHandler } from '../_shared/missionAgent/handler.ts';

Deno.serve(createAgentHandler({ onlySources: ['api_engagement'] }));
