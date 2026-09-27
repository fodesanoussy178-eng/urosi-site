// Point d'entrée HTTP commun de l'agent (Edge Functions `mission-agent` et,
// pour compatibilité, `import-api-engagement`).
//
// Authentification (verify_jwt = false, contrôle fait ici) :
//   - planifié : pg_cron + pg_net avec le secret MISSION_AGENT_CRON_SECRET
//     (ou l'ancien IMPORT_CRON_SECRET), jamais versionné ;
//   - manuel : jeton de session d'un compte fondateur (has_founder_access()),
//     bouton « Relancer maintenant » du Centre Fondateur.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createPoliteHttp } from './http.ts';
import { runMissionAgent } from './runner.ts';
import { ADAPTERS } from './sources/index.ts';
import { createSupabaseAgentStore } from './supabaseStore.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export function createAgentHandler(options: { onlySources?: string[] } = {}) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const cronSecrets = [Deno.env.get('MISSION_AGENT_CRON_SECRET'), Deno.env.get('IMPORT_CRON_SECRET')]
      .map((s) => (s ?? '').trim())
      .filter(Boolean);
    const provided = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!provided) return json({ error: "Accès réservé à l'équipe UROSI." }, 401);

    let trigger: 'manual' | 'cron';
    let triggeredBy: string | null = null;
    if (provided === serviceRoleKey || cronSecrets.includes(provided)) {
      trigger = 'cron';
    } else {
      const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${provided}` } },
      });
      const { data: userData } = await userClient.auth.getUser(provided);
      const { data: isFounder } = await userClient.rpc('has_founder_access');
      if (!userData?.user || isFounder !== true) return json({ error: "Accès réservé à l'équipe UROSI." }, 403);
      trigger = 'manual';
      triggeredBy = userData.user.id;
    }

    let onlySources = options.onlySources;
    if (!onlySources) {
      const body = await req.json().catch(() => null);
      if (Array.isArray(body?.sources)) onlySources = body.sources.map(String);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    try {
      const summary = await runMissionAgent({
        store: createSupabaseAgentStore(admin),
        adapters: ADAPTERS,
        http: createPoliteHttp({ fetch: (input, init) => fetch(input, init) }),
        env: (name) => Deno.env.get(name),
        trigger,
        triggeredBy,
        onlySources,
      });
      return json(summary, summary.status === 'error' ? 502 : 200);
    } catch (error) {
      return json({ error: (error as Error).message }, 500);
    }
  };
}
