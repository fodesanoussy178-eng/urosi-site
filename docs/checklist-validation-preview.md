# Checklist de validation — Preview Vercel avant merge sur `main`

> **Règle depuis le 2026-07-24** : plus aucun merge sur `main` (donc plus aucun
> déploiement sur `urosi.fr`) sans que cette checklist ait été entièrement
> validée sur une **Preview Vercel** branchée sur `urosi-staging`
> (`rxdbnwmmakykvnckwbhw`), jamais sur la production.
>
> Complémentaire à `docs/checklist-go-live.md` (blocages P0/P1/P2 identifiés
> à l'audit du 2026-07-20) : celui-ci est une checklist de **non-régression
> fonctionnelle** à rejouer à chaque cycle, pas une liste de blocages
> ponctuels.

## Avant de commencer

- [ ] La Preview Vercel du commit à valider pointe bien vers `urosi-staging`
      (`VITE_SUPABASE_URL=https://rxdbnwmmakykvnckwbhw.supabase.co`) —
      **jamais** vers la production. Vérifier dans les variables
      d'environnement de la Preview, pas seulement dans `.env.local`.
- [ ] Les migrations du cycle ont été appliquées sur `urosi-staging` (pas
      seulement écrites dans le dépôt).
- [ ] `npm run typecheck && npm run test && npm run lint` passent sans
      erreur en local avant même d'ouvrir la Preview.
- [ ] Deux comptes de test dédiés à ce cycle (un worker, une structure),
      distincts des comptes de production — jamais réutiliser un compte réel.

---

## 1. Comptes & session

- [ ] **Création de compte worker** : inscription, email de confirmation
      reçu, profil créé automatiquement (`profiles`), redirection correcte
      après confirmation.
- [ ] **Création de compte structure** : inscription avec SIRET, vérification
      automatique (`verify-structure` / annuaire des entreprises) ou bypass
      fondateur, structure créée avec le bon `owner_id`.
- [ ] **Connexion / déconnexion** : session persistée au rechargement,
      déconnexion invalide bien la session, redirection post-connexion vers
      la bonne page (y compris les liens `/scan/:token` et `/valider/:qrCode`
      — ne jamais rediriger vers `/app` dans ce cas).

## 2. Cycle de mission

- [ ] **Publication d'une mission** : validations client (titre, ville,
      adresse, dates futures, durée, tarif ≥ minimum) ; en cas d'erreur
      serveur, un message métier clair s'affiche (jamais de texte SQL brut ni
      un simple « Publication impossible ») ; le badge « Missions » de
      l'onglet ne compte que les missions non annulées.
- [ ] **Candidature** : un worker postule, impossible de postuler deux fois
      à la même mission (contrainte `mission_id, worker_id`).
- [ ] **Acceptation / refus** : refus immédiat ; acceptation directe si
      mission solidaire ou gratuite, sinon passage obligatoire par Stripe
      Checkout (voir §7) avant confirmation ; capacité de la mission
      respectée (pas de sur-réservation).
- [ ] **Messagerie** : fil actif tant que `conversation_status='open'` et la
      candidature n'est ni refusée ni annulée ; dès la fin réelle de mission
      (pointage de fin confirmé), le bouton Message disparaît immédiatement
      **et** l'envoi est refusé côté serveur même en forçant l'appel API
      (tester en DevTools, pas seulement visuellement).
- [ ] **QR arrivée** : jeton à usage unique, scan structure → confirmation,
      code de secours (PIN) fonctionnel en repli.
- [ ] **QR départ** : confirme `attendance_status='end_confirmed'`,
      `actual_end_at` posé, `payment_ready_at = actual_end_at + 3 jours`.
- [ ] **Fin de mission** : en une seule transaction — conversation fermée,
      entrée CV en `pending_verification`, demandes d'avis créées pour les
      deux parties, transaction wallet `pending` créée pour le travailleur.

## 3. Avis / réputation

- [ ] **Demande d'avis automatique (J+2 min)** : la popup de notation
      apparaît côté travailleur **et** côté structure environ 2 minutes après
      la fin de mission (`RATING_FIRST_PROMPT_DELAY_MINUTES`), jamais avant ;
      « Me le rappeler plus tard » reprogramme sans supprimer la demande
      (rappels à 24h puis 72h).
- [ ] **Anonymisation des avis** : les commentaires publics sur une structure
      (`public_structure_reviews`) ne révèlent jamais l'identité de l'auteur
      (pas de nom, pas d'`worker_id`), et ne sortent que par lots complets
      d'au moins 3 avis.
- [ ] **Affichage des avis à J+5** : la moyenne/nombre d'avis (structure
      comme travailleur) n'intègre un avis publié que 5 jours pleins après
      qu'il a été donné (`created_at`) — avec moins de 3 avis, la moyenne
      s'affiche quand même (sans commentaire) ; à 0 avis, « Pas encore
      évalué(e) – 0 avis » ; bouton « Lire les avis » fonctionnel.

## 4. Argent

- [ ] **Wallet J+3** : le solde `pending` apparaît dès la fin de mission,
      bascule en `available` à `payment_ready_at` (release cron / edge
      function), jamais avant.
- [ ] **Retrait** : ⚠️ les retraits réels (Stripe Connect) ne sont **pas**
      encore construits (décision produit — Document 2) ; vérifier seulement
      que le Wallet reflète correctement les mouvements simulés existants et
      qu'aucune UI ne promet un virement réel non tenu.
- [ ] **Remboursement** : annulation d'une mission payée → remboursement
      Stripe lancé, Wallet contre-passé à zéro net, notification « Mission
      remboursée » au travailleur, idempotent (rejouer ne double rembourse
      jamais).
- [ ] **Paiements Stripe** : Checkout Session créée avec un montant calculé
      **côté serveur uniquement**, session réutilisée si encore ouverte,
      redirection `/paiement/succes` et `/paiement/annule` correctes,
      `STRIPE_SECRET_KEY` reste une clé `sk_test_…` (le garde-fou refuse tout
      le reste).
- [ ] **Webhooks Stripe** : signature vérifiée, `checkout.session.completed
      /expired/failed` traités, idempotence par `event.id`
      (`claim/complete/fail_stripe_webhook_event`) — rejouer le même webhook
      ne crée pas de doublon.

## 5. Listes & tableaux de bord

- [ ] **Notifications** : reçues par le bon rôle au bon moment, marquage
      lu/archivé/supprimé fonctionnel, badge de non-lus jamais bloqué sur un
      fil de conversation déjà fermé.
- [ ] **Historique** : missions terminées visibles, archivage/désarchivage
      fonctionnel, une mission archivée reste consultable via le bouton dédié.
- [ ] **Habitués** : ne compte que les missions réellement `completed`
      (post-paiement), pas celles encore en attente de paiement J+3.
- [ ] **Candidats** : carte complète tant que la mission n'est pas terminée ;
      dès la fin réelle (pointage de fin, pas le statut de paiement seul),
      remplacée par un résumé simple (nom + missions réalisées) ; ce résumé
      disparaît automatiquement après J+3 ; badge « Habitué · N× » et note
      globale du candidat corrects.

## 6. Sécurité & plateforme

- [ ] **Permissions / RLS** : un compte A ne peut jamais lire le wallet, les
      paiements, les messages ou les candidatures d'un compte B (tester avec
      deux sessions réelles, pas seulement en lecture admin) ; aucune écriture
      client directe sur `wallets`/`wallet_transactions`/`payments`.
- [ ] **Responsive mobile/desktop** : barre de navigation en bas sur mobile,
      barre latérale sur desktop (bascule à 1024px), aucun élément coupé ou
      superposé aux deux tailles.
- [ ] **Non-régression générale** : rejouer un parcours complet worker et un
      parcours complet structure de bout en bout (pas seulement la
      fonctionnalité modifiée) ; comparer avec le comportement attendu du
      cycle précédent ; `npm run typecheck / test / lint` toujours au vert
      sur le dernier commit de la Preview.

---

## Validation finale

- [ ] Toutes les cases ci-dessus cochées sur la Preview Vercel (staging).
- [ ] Aucune régression constatée sur un flux non touché par ce cycle.
- [ ] Accord explicite donné avant merge sur `main`.

_Dernière mise à jour : 2026-07-24, après le cycle Messagerie/Avis/Wallet/Candidats._
