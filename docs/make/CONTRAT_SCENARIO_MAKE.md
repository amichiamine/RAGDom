# Contrat des scénarios Make.com — Provider « make » de RAGDom

> **Source de vérité :** ce document décrit EXACTEMENT ce que la fonction
> `_call_make()` de `backend/llm/key_manager.py` envoie et attend. Tout scénario
> Make.com branché sur RAGDom **doit** respecter ce contrat au caractère près,
> sinon la réponse est ignorée et le fallback (provider suivant, puis Ollama)
> est déclenché.

---

## 1. Rôle du provider « make » dans RAGDom

Le provider `make` est un **webhook no-code** : il n'a ni clé API, ni notion de
« modèle ». Il est activable au choix dans l'onglet **« Fournisseurs IA »**
(composant `ProvidersPanel`) et **suit l'ordre de priorité configurable** des
providers actifs, exactement comme les autres providers.

Concrètement (`generate()` dans `key_manager.py`) :

- Les providers activés sont parcourus **par priorité croissante** (`SELECT … WHERE is_enabled=1 ORDER BY priority`).
- Quand le tour de `make` arrive, RAGDom appelle `_call_make(base_url, prompt, timeout_s)`
  **si et seulement si** une `base_url` est renseignée pour ce provider.
- En cas de succès, RAGDom renvoie `{"content": …, "provider": "make/webhook", "fallback_triggered": …}`.
- En cas d'erreur HTTP, `fallback_triggered` passe à `True` et RAGDom **continue**
  vers le provider suivant dans l'ordre de priorité (et, en tout dernier recours, Ollama local).

Le comportement actuel est **conservé** : `make` n'est ni prioritaire ni imposé,
il s'insère simplement dans la chaîne selon la priorité que l'utilisateur lui donne.

---

## 2. Ce que RAGDom ENVOIE (requête sortante)

### 2.1 Méthode et URL

| Élément | Valeur |
| --- | --- |
| **Méthode HTTP** | `POST` |
| **URL** | La `base_url` du provider `make` telle que saisie dans l'UI (table `llm_settings`, colonne `base_url`). C'est l'URL du **Custom webhook** Make.com (ex. `https://hook.eu1.make.com/xxxxxxxxxxxxxxxxxxxxxxxx`). |
| **En-tête** | `Content-Type: application/json` (ajouté automatiquement par `httpx` quand on passe `json=`). Aucun en-tête d'authentification n'est envoyé. |

> ⚠️ L'URL est saisie telle quelle dans le champ **« URL de base »** de la
> section `make` de `ProvidersPanel`. Le placeholder affiché est
> `https://hook.eu1.make.com/…`. RAGDom **n'ajoute aucun suffixe** de chemin à
> cette URL (contrairement aux providers OpenAI-compatibles qui ajoutent
> `/chat/completions`) : le webhook doit répondre directement sur cette URL.

### 2.2 Corps JSON exact

```json
{
  "prompt": "<chaîne de caractères — le prompt complet construit par RAGDom>",
  "source": "ragdom"
}
```

| Clé | Type | Toujours présent ? | Description |
| --- | --- | --- | --- |
| `prompt` | `string` | Oui | Le prompt textuel complet (instruction + contenu à traiter). Peut être long (réparation LaTeX, OCR d'une page entière décrite en texte, etc.). |
| `source` | `string` (constante `"ragdom"`) | Oui | Marqueur d'origine, utile pour filtrer/router côté Make. Toujours la valeur littérale `ragdom`. |

**Il n'y a AUCUNE autre clé dans le corps.**

### 2.3 Cas image / multimodal — IMPORTANT

**L'image N'EST PAS transmise au webhook Make.com.**

Le paramètre `image_b64` existe dans `generate()` / `_call_provider()` et est
transmis aux providers natifs (Gemini, Anthropic, OpenAI-compatibles), **mais la
signature de `_call_make(base_url, prompt, timeout_s)` ne comporte pas
`image_b64`**. Lors d'un appel multimodal, seul le champ `prompt` (texte) part
vers Make.

**Conséquences pour la conception des scénarios :**

- Un scénario Make branché comme provider `make` ne reçoit **que du texte**.
- Un scénario « OCR page entière » **ne peut pas** recevoir l'image via ce canal
  tant que le contrat n'évolue pas : il doit se contenter du `prompt` (qui peut
  contenir une description ou des instructions), ou récupérer l'image par un
  autre moyen hors RAGDom (non couvert par ce contrat).
- Si un jour l'image devait être transmise, il faudrait faire évoluer
  `_call_make` **et** ce contrat de concert (nouvelle clé, ex. `image_b64`).

### 2.4 Timeout

| Paramètre | Valeur |
| --- | --- |
| **Timeout httpx** | `timeout_s`, transmis par l'appelant. Par défaut `config.VLM_TIMEOUT_SECONDS` = **30 s** (variable d'environnement `VLM_TIMEOUT_SECONDS`). |

Si le scénario Make **ne répond pas** dans ce délai, `httpx` lève une exception
`httpx.HTTPError` (timeout) → traitée comme un échec → **fallback** vers le
provider suivant. Le webhook doit donc répondre **bien avant** ce délai.

---

## 3. Ce que RAGDom ATTEND (réponse entrante)

### 3.1 Code HTTP

`_call_make` appelle `response.raise_for_status()` :

- **2xx** → la réponse est parsée (voir §3.2).
- **Tout code ≥ 400** (4xx / 5xx) → lève `httpx.HTTPStatusError` (sous-classe de
  `httpx.HTTPError`) → **échec** → `fallback_triggered = True` → provider suivant.

> Le webhook Make **doit** répondre en **200** pour que la réponse soit prise en
> compte. Un module « Webhook response » avec `Status: 200` est requis.

### 3.2 Corps de réponse — structure exacte parsée

Le code de parsing est :

```python
payload = response.json()
return payload.get("content") or payload.get("answer") or response.text
```

Ordre de résolution du texte renvoyé à RAGDom :

1. **Si la réponse est un JSON valide :**
   - `content` s'il est présent **et non vide** → utilisé ;
   - sinon `answer` s'il est présent **et non vide** → utilisé ;
   - sinon `response.text` (le corps brut, y compris le JSON sérialisé).
2. **Si la réponse n'est pas un JSON valide** (`ValueError`) → `response.text`
   (le corps brut est renvoyé tel quel).

> ⚠️ `or` en Python est faux pour une **chaîne vide**, `0`, `null`, `false`.
> Donc `{"content": ""}` retombe sur `answer`, puis sur le texte brut. Le
> scénario doit renvoyer un `content` **non vide**.

### 3.3 Forme recommandée (canonique)

```json
{
  "content": "<le texte produit par le LLM — LaTeX réparé, réponse OCR, etc.>"
}
```

- `content` : `string` non vide. **C'est la forme à privilégier.**
- `answer` : `string` — alias accepté si `content` est absent/vide (compatibilité).
- Toute autre clé est **ignorée** par RAGDom (mais n'empêche pas le parsing).

RAGDom ne lit **que** `content` ou `answer`. Il n'exploite ni un tableau de
`choices`, ni une structure imbriquée : la clé doit être **à la racine** de
l'objet JSON.

---

## 4. Interprétation des erreurs (rotation / fallback)

`make` n'ayant pas de clé API, il n'y a **ni rotation de clé, ni blocage
temporaire, ni désactivation** propre à ce provider. La logique de `_call_make`
dans `generate()` est simple :

```python
if provider == "make":
    if base_url:
        try:
            content = _call_make(base_url, prompt, timeout_s)
            return {"content": content, "provider": "make/webhook",
                    "fallback_triggered": fallback_triggered}
        except httpx.HTTPError:
            fallback_triggered = True
    continue
```

| Situation | Exception | Effet dans RAGDom |
| --- | --- | --- |
| `base_url` vide / non renseignée | (aucun appel) | `make` est **sauté**, on passe au provider suivant. |
| Réponse **200** JSON avec `content`/`answer` non vide | — | **Succès** : `content` renvoyé, `provider = "make/webhook"`. |
| Réponse **200** sans JSON parsable | — | **Succès** : le corps brut (`response.text`) est renvoyé. |
| Réponse **4xx** (400, 401, 403, 404, 422, 429…) | `httpx.HTTPStatusError` | **Échec** → `fallback_triggered=True` → provider suivant. Pas de blocage, pas de retry sur `make`. |
| Réponse **5xx** (500, 502, 503, 504…) | `httpx.HTTPStatusError` | **Échec** → `fallback_triggered=True` → provider suivant. **Pas de backoff exponentiel** pour `make` (contrairement aux providers à clé). |
| **Timeout** (> `timeout_s`) | `httpx.HTTPError` (timeout) | **Échec** → `fallback_triggered=True` → provider suivant. |
| Réseau injoignable / DNS / TLS | `httpx.HTTPError` | **Échec** → `fallback_triggered=True` → provider suivant. |

> **À retenir :** pour `make`, RAGDom ne fait **aucun retry** interne. Le
> scénario n'a droit qu'à **un seul essai** par appel. Toute robustesse (retry,
> fallback entre plusieurs LLM) doit être gérée **à l'intérieur du scénario
> Make** (voir le prompt (b) « fallback multi-LLM » dans
> `PROMPTS_SCENARIOS_MAKE.md`).

---

## 5. Exigences côté scénario Make.com

### 5.1 Modules obligatoires

1. **Custom webhook** (module « Webhooks » → « Custom webhook ») en déclencheur.
   - C'est ce module qui fournit l'URL à coller dans le champ **« URL de base »**
     de RAGDom.
   - Le webhook reçoit le corps JSON `{"prompt": …, "source": "ragdom"}`.
2. **Webhook response** (module « Webhooks » → « Webhook response ») en fin de
   scénario.
   - `Status`: **200**.
   - `Body`: un JSON **strict** de la forme `{"content": "…"}`.
   - `Headers`: `Content-Type: application/json`.

Sans module « Webhook response », Make renvoie par défaut le texte
`Accepted` — ce qui, côté RAGDom, serait interprété comme un `content` textuel
inutile. **Le module de réponse est donc indispensable.**

### 5.2 Règles impératives

| Exigence | Détail |
| --- | --- |
| **JSON strict** | Le corps de réponse doit être un JSON valide `{"content": "…"}`. Échapper correctement les guillemets/retours à la ligne (le LaTeX en contient beaucoup). Utiliser un module qui sérialise proprement (ex. « Create JSON ») plutôt qu'une concaténation manuelle. |
| **`content` non vide** | Toujours renvoyer un `content` non vide en cas de succès (sinon RAGDom retombe sur `answer` puis sur le corps brut). |
| **Latence < timeout** | Répondre en **moins de ~25 s** pour garder une marge sous les 30 s de `VLM_TIMEOUT_SECONDS`. Choisir des modèles LLM rapides ; éviter les étapes lentes inutiles. |
| **Idempotence** | Le même `prompt` doit produire un résultat équivalent et **ne provoquer aucun effet de bord** (pas d'écriture en base, pas d'envoi d'e-mail, pas d'incrément de compteur non réversible). RAGDom peut ré-appeler le webhook (nouveaux essais utilisateur, ré-exécutions de pipeline). |
| **Gestion des erreurs = réponse JSON, pas timeout** | En cas d'échec **interne** au scénario, renvoyer **quand même** une « Webhook response » — de préférence en **200 avec un `content` de repli** si l'on veut éviter le fallback, **ou** en **4xx/5xx** si l'on veut explicitement déclencher le fallback RAGDom. **Ne jamais laisser le scénario expirer** : un timeout coûte 30 s à l'utilisateur et est moins clair qu'une erreur explicite. |

### 5.3 Chaîne d'erreur recommandée dans Make

- Ajouter un **gestionnaire d'erreurs** (route d'erreur / « Error handler ») sur
  le module LLM.
- En bout de route d'erreur, placer une **« Webhook response »** :
  - soit **200** + `{"content": "<repli>"}` si un repli textuel est acceptable,
  - soit un code **5xx** + `{"error": "<raison>"}` pour signaler l'échec et
    laisser RAGDom basculer sur le provider suivant.
- RAGDom ne lit pas la clé `error` (elle est ignorée), mais le **code HTTP ≥ 400**
  suffit à déclencher le fallback : la clé `error` sert surtout à la lisibilité
  et au debug côté Make.

---

## 6. Exemples complets

### 6.1 Requête envoyée par RAGDom (réparation LaTeX)

```
POST https://hook.eu1.make.com/xxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json

{
  "prompt": "Corrige et complète ce fragment LaTeX invalide en un LaTeX strictement compilable. Ne renvoie QUE le LaTeX corrigé, sans commentaire.\n\n\\frac{a}{b  avec b \\neq 0",
  "source": "ragdom"
}
```

### 6.2 Réponse valide attendue (succès)

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "content": "\\frac{a}{b} \\quad \\text{avec } b \\neq 0"
}
```

RAGDom renvoie alors :

```json
{
  "content": "\\frac{a}{b} \\quad \\text{avec } b \\neq 0",
  "provider": "make/webhook",
  "fallback_triggered": false
}
```

### 6.3 Réponse d'erreur explicite (déclenche le fallback proprement)

```
HTTP/1.1 502 Bad Gateway
Content-Type: application/json

{
  "error": "Aucun LLM interne disponible"
}
```

→ Côté RAGDom : `httpx.HTTPStatusError` → `fallback_triggered = True` → passage
au provider suivant (puis Ollama). **Aucun blocage** du provider `make`.

### 6.4 Test rapide en `curl` (simule l'appel RAGDom)

```bash
curl -sS -X POST "https://hook.eu1.make.com/xxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Corrige ce LaTeX : \\frac{a}{b avec b \\neq 0","source":"ragdom"}'
```

Réponse attendue : un JSON `{"content":"…"}` en HTTP 200, en moins de ~25 s.

---

## 7. Check-list de conformité

- [ ] Déclencheur = **Custom webhook** ; l'URL fournie est collée dans **« URL de base »** (section `make`).
- [ ] Fin de scénario = **Webhook response**, `Status: 200`, `Content-Type: application/json`.
- [ ] Le corps de réponse est un **JSON strict** `{"content": "…"}` avec `content` **non vide**.
- [ ] Le scénario lit `prompt` (et éventuellement filtre sur `source == "ragdom"`).
- [ ] Le scénario **ne dépend pas** d'une image (non transmise par le contrat actuel).
- [ ] Latence de bout en bout **< ~25 s**.
- [ ] Scénario **idempotent**, sans effet de bord.
- [ ] Route d'erreur qui renvoie **toujours** une réponse (JSON 200 de repli **ou** 4xx/5xx explicite), **jamais** un timeout.
