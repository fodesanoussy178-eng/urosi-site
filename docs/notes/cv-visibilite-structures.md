# Règle produit — Visibilité du CV vivant côté structures

> Décision du fondateur (17/07/2026). Illustrée dans la démo
> (`DemoExperience.tsx` : `workerCvShareAll`, `publicCvHistory`). L'app
> réelle est déjà conforme sur le point des revenus : le panneau candidat
> de `StructureApp` n'affiche que nom, note reçue, nombre d'avis et
> « chez toi » — ni historique détaillé, ni montants.

1. **Les revenus du travailleur ne sont JAMAIS visibles par une
   structure.** Aucun montant, aucun total, aucune rémunération de
   mission — quel que soit le consentement. Les revenus ne regardent que
   le travailleur (et UROSI).
2. **Le partage de l'historique de missions est un consentement du
   travailleur** : un interrupteur unique « Tout partager » (OFF par
   défaut).
   - OFF : la structure ne voit que les **2 missions les plus récentes**
     (titre + catégorie).
   - ON : la structure voit tout l'historique vérifié (titres +
     catégories, toujours sans montants).
3. À l'implémentation réelle (quand le CV détaillé sera exposé aux
   structures) : colonne `profiles.cv_share_all boolean default false`
   via nouvelle migration, et une RPC `security definer` qui applique le
   filtre côté serveur (jamais côté client). Ne jamais inclure
   `worker_rate_cents`/wallet dans ce que renvoie cette RPC.
