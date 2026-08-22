# Prompts pour l'« AI Scenario Builder » de Make.com

> Ces trois prompts sont **prêts à coller** dans l'agent IA de création de
> scénarios de Make.com (« AI Scenario Builder » / assistant de génération de
> scénario). Chacun est **autonome, en français**, et impose le **respect STRICT
> du contrat** défini dans `CONTRAT_SCENARIO_MAKE.md`.
>
> **Rappel du contrat (recopié dans chaque prompt) :**
> - RAGDom envoie `POST` avec le corps JSON `{"prompt": "<texte>", "source": "ragdom"}`.
> - RAGDom attend une réponse **HTTP 200**, `Content-Type: application/json`,
>   de la forme **`{"content": "<texte produit>"}`** (`content` non vide).
> - **Aucune image n'est transmise** : le scénario ne reçoit que du texte.
> - Timeout RAGDom = **30 s** → répondre en **< 25 s**.
> - RAGDom ne fait **aucun retry** : toute robustesse est interne au scénario.

Après génération, **tester chaque scénario** :
1. Cliquer sur **« Run once »** dans Make (le scénario se met en écoute du webhook).
2. Lancer le `curl` d'exemple fourni sous chaque prompt (remplacer l'URL par
   celle du Custom webhook généré).
3. Vérifier que la réponse est bien `{"content":"…"}` en HTTP 200.
4. Coller l'URL du webhook dans RAGDom : onglet **« Fournisseurs IA »** →
   section **`make`** → champ **« URL de base »**, puis activer le provider et
   régler sa priorité.

---

## Prompt (a) — Scénario minimal de réparation LaTeX

```
Crée un scénario Make.com nommé « RAGDom - Réparation LaTeX (minimal) ».

CONTEXTE
Ce scénario est appelé par l'application RAGDom comme fournisseur LLM « webhook ».
RAGDom envoie une requête HTTP POST dont le corps JSON est EXACTEMENT :
  { "prompt": "<texte>", "source": "ragdom" }
RAGDom attend en retour une réponse HTTP 200 avec l'en-tête
Content-Type: application/json et un corps JSON STRICT de la forme :
  { "content": "<texte produit par le LLM>" }
La clé "content" doit être NON VIDE. Aucune image n'est envoyée : le scénario ne
reçoit que du texte via le champ "prompt". RAGDom impose un délai maximal de 30
secondes et ne réessaie jamais : réponds en moins de 25 secondes.

MODULES À CRÉER (dans cet ordre)
1. « Webhooks » → « Custom webhook » comme déclencheur. Nomme-le
   « RAGDom in ». Ce webhook recevra le corps { "prompt": ..., "source": "ragdom" }.
2. UN module LLM au choix de l'utilisateur (OpenAI « Create a chat completion »,
   Anthropic Claude, Google Gemini, Mistral, ou équivalent). Configure-le ainsi :
   - message système : « Tu es un correcteur LaTeX. On te donne un fragment LaTeX
     potentiellement invalide ou incomplet. Renvoie UNIQUEMENT le LaTeX corrigé,
     strictement compilable, sans aucun commentaire ni texte autour. »
   - message utilisateur : la valeur du champ "prompt" reçu du webhook
     (mapping : {{1.prompt}}).
   - température basse (0 à 0.2), max tokens ~2048.
3. « Webhooks » → « Webhook response » comme dernier module. Configure :
   - Status : 200
   - Headers : Content-Type = application/json
   - Body : un JSON STRICT { "content": "<sortie du module LLM>" }. Utilise une
     sérialisation JSON propre (module « Create JSON » ou la fonction
     toString/JSON adaptée) pour échapper correctement les guillemets et les
     retours à la ligne présents dans le LaTeX. La valeur de "content" est la
     réponse texte du module LLM.

GESTION DES ERREURS (obligatoire)
Ajoute une route d'erreur sur le module LLM. En bout de route d'erreur, place une
« Webhook response » qui renvoie soit :
  - HTTP 200 avec { "content": "<le fragment reçu, inchangé>" } si tu veux un repli,
  - soit HTTP 502 avec { "error": "<raison>" } pour laisser RAGDom basculer sur un
    autre fournisseur.
Ne laisse JAMAIS le scénario expirer sans réponse.

CONTRAINTES
- Le scénario doit être IDEMPOTENT et sans effet de bord (aucune écriture en base,
  aucun e-mail, aucun compteur).
- Ne renvoie que les clés du contrat : "content" (ou "error" en cas d'échec).
- Respecte au caractère près la forme { "content": "..." }.
```

**Test :**
1. Dans Make, ouvre le scénario puis clique **« Run once »**.
2. Exécute (remplace l'URL par celle de ton Custom webhook) :

```bash
curl -sS -X POST "https://hook.eu1.make.com/REMPLACE_MOI" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Corrige et complète ce LaTeX : \\frac{a}{b avec b \\neq 0","source":"ragdom"}'
```

3. Attendu : `{"content":"\\frac{a}{b} \\quad \\text{avec } b \\neq 0"}` (HTTP 200, < 25 s).

---

## Prompt (b) — Scénario avec fallback multi-LLM interne à Make

```
Crée un scénario Make.com nommé « RAGDom - Réparation LaTeX (fallback 2 LLM) ».

CONTEXTE
Ce scénario est appelé par l'application RAGDom comme fournisseur LLM « webhook ».
RAGDom envoie une requête HTTP POST dont le corps JSON est EXACTEMENT :
  { "prompt": "<texte>", "source": "ragdom" }
RAGDom attend en retour une réponse HTTP 200 avec l'en-tête
Content-Type: application/json et un corps JSON STRICT de la forme :
  { "content": "<texte produit par le LLM>" }
La clé "content" doit être NON VIDE. Aucune image n'est envoyée. Timeout RAGDom =
30 secondes ; RAGDom ne réessaie jamais. Le scénario doit donc gérer LUI-MÊME sa
robustesse via un fallback interne entre DEUX modules LLM, et répondre en moins de
25 secondes au total.

MODULES À CRÉER (dans cet ordre)
1. « Webhooks » → « Custom webhook » comme déclencheur (« RAGDom in »). Corps reçu :
   { "prompt": ..., "source": "ragdom" }.
2. LLM PRIMAIRE : un premier module LLM (ex. OpenAI « Create a chat completion »).
   - système : « Tu es un correcteur LaTeX. Renvoie UNIQUEMENT le LaTeX corrigé,
     strictement compilable, sans commentaire. »
   - utilisateur : {{1.prompt}}
   - température 0 à 0.2, max tokens ~2048.
3. ROUTE D'ERREUR sur le LLM primaire → LLM SECONDAIRE : un second module LLM
   d'un AUTRE fournisseur (ex. Anthropic Claude ou Google Gemini), configuré avec
   le même message système et le même {{1.prompt}}. C'est le repli si le primaire
   échoue (quota, erreur, indisponibilité).
4. « Webhooks » → « Webhook response » comme module terminal, atteint depuis
   les DEUX branches (succès primaire OU succès secondaire) :
   - Status : 200
   - Headers : Content-Type = application/json
   - Body : JSON STRICT { "content": "<sortie du LLM ayant répondu>" }. Sérialise
     proprement (échappement des guillemets et retours à la ligne). Utilise un
     mapping conditionnel qui prend la sortie du primaire si présente, sinon celle
     du secondaire (ex. via une variable ou la fonction ifempty).
5. ROUTE D'ERREUR sur le LLM secondaire → une « Webhook response » finale de
   dernier recours : HTTP 502 avec { "error": "Les deux LLM ont échoué" }, afin que
   RAGDom bascule proprement sur le fournisseur suivant.

CONTRAINTES
- Réponds TOUJOURS (jamais de timeout) : chaque branche se termine par une
  « Webhook response ».
- IDEMPOTENT, sans effet de bord.
- Ne renvoie que "content" (succès) ou "error" (échec total).
- Respecte au caractère près la forme { "content": "..." }.
- Garde la latence totale des deux tentatives sous 25 secondes (choisis des
  modèles rapides et des max tokens raisonnables).
```

**Test :**
1. **« Run once »** dans Make.
2. Tester le chemin nominal :

```bash
curl -sS -X POST "https://hook.eu1.make.com/REMPLACE_MOI" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Corrige ce LaTeX : x^2 + y^2 = r^2 \\text{ pour tout r>0","source":"ragdom"}'
```

3. Attendu : `{"content":"…LaTeX corrigé…"}` (HTTP 200). Pour vérifier le fallback,
   invalide temporairement la clé du LLM primaire et relance : le secondaire doit
   répondre, avec toujours un `{"content":"…"}` en 200.

---

## Prompt (c) — Scénario OCR page entière (adapté au contrat texte-seul)

```
Crée un scénario Make.com nommé « RAGDom - OCR / transcription page ».

CONTEXTE ET LIMITE IMPORTANTE DU CONTRAT
Ce scénario est appelé par RAGDom comme fournisseur LLM « webhook ». RAGDom envoie
une requête HTTP POST dont le corps JSON est EXACTEMENT :
  { "prompt": "<texte>", "source": "ragdom" }
IMPORTANT : le contrat actuel de RAGDom NE TRANSMET PAS D'IMAGE au webhook. La
fonction interne _call_make n'envoie que le champ "prompt" (texte). Il n'y a donc
AUCUNE clé image, image_b64 ou url dans le corps reçu. Ce scénario doit donc
travailler UNIQUEMENT à partir du texte du champ "prompt" : le "prompt" contient
l'instruction d'OCR/transcription et, le cas échéant, un texte OCR brut déjà
extrait en amont à nettoyer/structurer. Ne suppose jamais recevoir une image.

RAGDom attend en retour une réponse HTTP 200 avec l'en-tête
Content-Type: application/json et un corps JSON STRICT :
  { "content": "<transcription/mise en forme produite>" }
"content" doit être NON VIDE. Timeout RAGDom = 30 secondes, aucun retry : réponds
en moins de 25 secondes.

MODULES À CRÉER (dans cet ordre)
1. « Webhooks » → « Custom webhook » comme déclencheur (« RAGDom in »). Corps reçu :
   { "prompt": ..., "source": "ragdom" }.
2. UN module LLM au choix (OpenAI, Anthropic, Gemini, Mistral…), configuré ainsi :
   - message système : « Tu es un moteur de transcription et de mise en forme de
     page de manuel scientifique. À partir du texte fourni, produis une
     transcription fidèle et propre en Markdown, avec le LaTeX inline entre $...$
     et les formules en bloc entre $$...$$. Ne renvoie QUE la transcription, sans
     commentaire. »
   - message utilisateur : {{1.prompt}}
   - température basse, max tokens ~2048.
3. « Webhooks » → « Webhook response » comme dernier module :
   - Status : 200
   - Headers : Content-Type = application/json
   - Body : JSON STRICT { "content": "<sortie du module LLM>" }, sérialisé
     proprement (échappement des guillemets, retours à la ligne et backslashes du
     LaTeX).

GESTION DES ERREURS (obligatoire)
Route d'erreur sur le module LLM → « Webhook response » de repli : soit HTTP 200
avec { "content": "<le texte reçu, inchangé>" }, soit HTTP 502 avec
{ "error": "<raison>" } pour déclencher le fallback RAGDom. Jamais de timeout.

CONTRAINTES
- N'attends AUCUNE image : uniquement le champ "prompt" texte.
- IDEMPOTENT, sans effet de bord.
- Ne renvoie que "content" (succès) ou "error" (échec).
- Respecte au caractère près la forme { "content": "..." }.
- Latence < 25 secondes.

NOTE (évolution future)
Si un jour RAGDom transmet l'image, il faudra ajouter une clé (ex. "image_b64")
côté _call_make ET mettre à jour le contrat. En attendant, ce scénario reste
strictement texte-seul.
```

**Test :**
1. **« Run once »** dans Make.
2. Exécuter :

```bash
curl -sS -X POST "https://hook.eu1.make.com/REMPLACE_MOI" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Transcris et mets en forme en Markdown+LaTeX ce texte OCR brut : Theoreme de Pythagore a2 + b2 = c2 pour un triangle rectangle.","source":"ragdom"}'
```

3. Attendu : `{"content":"…transcription en Markdown avec $a^2 + b^2 = c^2$…"}`
   (HTTP 200, < 25 s).

---

## Rappel — branchement dans RAGDom

1. Copier l'URL du **Custom webhook** généré par Make.
2. RAGDom → onglet **« Fournisseurs IA »** → section **`make`** →
   champ **« URL de base »** : coller l'URL.
3. Activer l'interrupteur du provider `make` et définir sa **priorité** (ordre
   d'appel parmi les providers actifs).
4. Le provider `make` s'insère alors dans la chaîne de fallback selon sa priorité,
   sans modifier le comportement des autres providers.
