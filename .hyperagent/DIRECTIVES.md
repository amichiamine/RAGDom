# DIRECTIVES UTILISATEUR (ArchiSys3.0) — ordres permanents, verbatim d'esprit

1. **GO permanent** : « n'attends pas mes validations… mène le projet jusqu'au
   bout, avec rigueur, en conformité à la documentation, sans arrêt et non-stop ».
   Agir d'abord, rendre compte ensuite. Déployer autant d'agents que nécessaire.
2. **ZÉRO valeur en dur, nulle part** — y compris noms de modèles LLM
   (auto-détection LIVE obligatoire), données de démo, mocks. Tout vient des API
   et des données réelles. L'utilisateur VÉRIFIE et relève toute contradiction.
3. **Preuves par exécution réelle** : chaque affirmation testée (curl, pytest,
   requêtes SQL, navigateur). Jamais « ça devrait marcher ».
4. **Compte rendu bref, concis, précis** — chiffres, tableaux, pas de discours.
5. **Branche unique : main** (depuis 2026-08-22). post-v1 gelée — ne plus la
   traiter SAUF demande expresse (économie de crédits/tokens de l'utilisateur).
6. **Login par NOM D'UTILISATEUR** (jamais email) + mot de passe, sqlite embarqué
   (scrypt). .env versionné PRÉ-REMPLI (sans secrets) avec mode d'emploi.
7. **Jamais de secrets dans le dépôt public** (clés API → env Render / seed).
   Jamais demander de coller un secret dans le chat (flux OAuth device GitHub OK).
8. **Ce dossier .hyperagent/ est LA mémoire** : à jour à chaque passe, poussé
   sur GitHub. En cas de nouveau fil : le lire intégralement AVANT d'agir.
9. Badge moteur hors header (métrique d'accueil). UI arabe RTL par défaut,
   trilingue fr/ar/en, thème dual.
10. Après chaque lot : tsc + build + pytest → push main → redéploiement Render
    (API) → VÉRIFICATION LIVE réelle.
