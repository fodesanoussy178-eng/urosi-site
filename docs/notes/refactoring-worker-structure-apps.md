# Note technique — Découpage futur de WorkerApp / StructureApp (audit fluidité P6)

> Statut : chantier NON lancé (décision du 16/07/2026 : notes seulement).
> À planifier hors des lots de correction rapides, avec mesures avant/après.

## Constat (audit performance du 16/07/2026)

- `src/features/worker/WorkerApp.tsx` (~1 200 lignes) et
  `src/features/structure/StructureApp.tsx` (~1 100 lignes) sont des
  composants monolithiques : ~20-25 `useState` au même niveau.
- Conséquence : chaque frappe clavier dans un champ (note de signalement,
  commentaire de notation, formulaire SIRET…) re-rend l'écran entier,
  y compris les listes de missions/candidatures et leurs styles inline
  recréés à chaque rendu.
- Impact réel : perceptible surtout sur mobiles d'entrée de gamme avec de
  longues listes ; non bloquant aujourd'hui (volumes faibles).

## Chantier proposé (dans l'ordre, chaque étape livrable seule)

1. **Extraire les feuilles pures** : `FluxCard`, `MissionRow`,
   `CandidateRow`, les sheets (détail mission, profil structure, notation,
   signalement, KYC) dans des fichiers dédiés, props explicites,
   `React.memo` sur les items de liste.
2. **Isoler l'état des formulaires** dans les sheets qui les possèdent
   (le texte d'un commentaire n'a pas à vivre dans le composant racine).
3. **Regrouper les données chargées** dans un hook par espace
   (`useWorkerData` / `useStructureData`) qui expose des maps stables ;
   conserver le debounce realtime introduit le 16/07/2026.
4. **Mesurer** avec React Profiler avant/après chaque étape (cible :
   une frappe clavier ne re-rend plus que la sheet ouverte).

## Garde-fous

- Aucun changement visuel ni de parcours : découpage à iso-rendu strict.
- Ne pas toucher aux règles métier ni aux appels services existants.
- Interdire les hooks de données dans les feuilles : les données restent
  chargées en haut, passées en props.
- Chaque étape = un commit, tests verts (`npm test`) + vérification
  manuelle des deux espaces.
