// Registre des adaptateurs de sources. Ajouter une source :
//   1. vérifier que son usage automatisé est autorisé (API, open data, flux
//      RSS/XML/JSON publiés pour être réutilisés, ou page dont les conditions
//      l'autorisent explicitement) et noter la base légale ;
//   2. écrire un adaptateur qui ne lit QUE des champs documentés par la source
//      et passe par ctx.http (robots.txt, anti-bot, User-Agent explicite) ;
//   3. l'enregistrer ici, puis insérer la ligne public.mission_sources
//      (enabled = false), la faire vérifier, et seulement ensuite l'activer.
// Voir docs/mission-agent.md.
import type { SourceAdapter } from '../types.ts';
import { apiEngagementAdapter } from './apiEngagement.ts';

export const ADAPTERS: Record<string, SourceAdapter> = {
  api_engagement_v0: apiEngagementAdapter,
};
