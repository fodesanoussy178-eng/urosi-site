// Edge Function `mission-agent` — agent de découverte des missions.
//
// Prévu pour tourner toutes les 3 heures (supabase/manual/schedule_mission_agent.sql,
// à appliquer UNIQUEMENT une fois la clé API Engagement et les sources
// configurées) et relançable depuis le Centre Fondateur (« Agent Missions »).
// Logique : _shared/missionAgent (runner.ts, sources/, http.ts). Journal :
// public.external_import_runs (source = 'mission_agent').
//
// Secrets : API_ENGAGEMENT_KEY (sans elle, run « non configuré », rien n'est
// modifié), MISSION_AGENT_CRON_SECRET. Optionnels : API_ENGAGEMENT_URL,
// IMPORT_LAT, IMPORT_LON, IMPORT_DISTANCE_KM, IMPORT_MAX_MISSIONS.
// Déploiement : supabase functions deploy mission-agent --no-verify-jwt
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createAgentHandler } from '../_shared/missionAgent/handler.ts';

Deno.serve(createAgentHandler());
