# 📋 Guide : Où Trouver les Logs du Backend

## ❌ PAS sur http://localhost:8001 !

Les logs **ne sont PAS** sur le navigateur. L'URL http://localhost:8001 est l'API web, pas les logs.

---

## ✅ Les Logs sont dans la CONSOLE

Les logs s'affichent dans la **fenêtre PowerShell/cmd** où le backend tourne.

---

## 🖥️ À Quoi Ça Ressemble

### Fenêtre du Backend (Console/Terminal)

```
┌─────────────────────────────────────────────────┐
│ ⬜ Backend API                              ❌ │
├─────────────────────────────────────────────────┤
│                                                 │
│ C:\...\RunYourShapePOC\backend>                │
│ venv\Scripts\python.exe -m uvicorn ...         │
│                                                 │
│ INFO: Uvicorn running on http://0.0.0.0:8001   │
│ INFO: Started server process                   │
│ INFO: Application startup complete.            │
│                                                 │
│ ← ICI apparaissent les logs quand vous         │
│    générez une route !                          │
│                                                 │
│ === ROUTE GENERATION START ===                 │
│ Start point: (48.8566, 2.3522)                 │
│ Target distance: 5.0 km                        │
│ Graph loaded: 12453 nodes, 18901 edges         │
│ ...                                             │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 🚀 Solution SIMPLE : Relancer avec Fenêtre Visible

### Étape 1 : Double-cliquez sur ce fichier

```
START_BACKEND_LOGS.bat
```

(Je viens de le créer pour vous !)

### Étape 2 : Une fenêtre s'ouvre

Vous verrez :

```
================================================
  BACKEND - Logs Visibles
================================================

Cette fenetre affiche les logs du backend
NE LA FERMEZ PAS !

Quand vous generez une route dans le frontend,
les logs apparaitront ICI.

================================================

Activation de l'environnement virtuel...
Demarrage du backend sur http://localhost:8001

--- LOGS CI-DESSOUS ---

INFO:     Uvicorn running on http://0.0.0.0:8001
INFO:     Started server process [xxxxx]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

### Étape 3 : Générez une Route

Dans le frontend (http://localhost:5173), cliquez "GENERATE ROUTE"

### Étape 4 : Regardez la Fenêtre

Dans la fenêtre du backend, vous verrez apparaître :

```
INFO:     127.0.0.1:52394 - "POST /route HTTP/1.1" 200 OK

=== ROUTE GENERATION START ===
Start point: (48.8566, 2.3522)
Target distance: 5.0 km
Symbol points: 100
Loading OSM graph with radius: 4.0 km...
Graph loaded: 12453 nodes, 18901 edges

Trying 40 combinations...
  Attempt 1: rotation=0°, scale=1.0x → snap_rate=15.2%
  Attempt 2: rotation=0°, scale=0.9x → snap_rate=18.7%
  Attempt 3: rotation=0°, scale=0.8x → snap_rate=22.1%

=== RESULTS ===
Total attempts: 40
Successful snaps (>20%): 8
Best route found: YES
Best success rate: 22.1%
Route length: 5.23 km
Route nodes: 234
```

### Étape 5 : Copiez les Logs

Sélectionnez le texte dans la fenêtre (clic droit → Sélectionner tout)
Puis copiez (clic droit → Copier) et envoyez-moi !

---

## 🔍 Alternative : Trouver la Fenêtre Existante

Si vous avez déjà lancé le backend mais ne trouvez pas la fenêtre :

### Windows :

1. **Alt + Tab** : Fait défiler toutes les fenêtres ouvertes
2. Cherchez une fenêtre avec "Backend" ou "cmd" ou "PowerShell"
3. Ou cherchez l'icône Python/Terminal dans la barre des tâches

### Barre des tâches :

Regardez en bas de l'écran, cherchez :
- 🐍 **Python**
- ⬛ **cmd.exe**
- 🔷 **PowerShell**

Clic droit → **Restaurer** si elle est minimisée

---

## 📊 Types de Logs que Vous Verrez

### 1. Logs de Démarrage (au lancement)
```
INFO:     Uvicorn running on http://0.0.0.0:8001
INFO:     Started reloader process [12345]
INFO:     Started server process [12346]
INFO:     Application startup complete.
```

### 2. Logs d'API (quand frontend appelle backend)
```
INFO:     127.0.0.1:52394 - "GET /symbols HTTP/1.1" 200 OK
INFO:     127.0.0.1:52395 - "POST /route HTTP/1.1" 200 OK
```

### 3. Logs de Génération (ce qu'on veut voir !)
```
=== ROUTE GENERATION START ===
Start point: (48.8566, 2.3522)
Target distance: 5.0 km
...
=== RESULTS ===
Best route found: YES/NO
```

---

## ⚠️ Erreurs Communes

### "Je ne vois rien quand je génère"

Possibilités :
1. ❌ Vous regardez le navigateur (http://localhost:8001) au lieu de la console
2. ❌ Le backend s'est arrêté
3. ❌ Vous regardez la mauvaise fenêtre de terminal

### "La fenêtre se ferme immédiatement"

Si la fenêtre du backend se ferme :
- ✅ Utilisez `START_BACKEND_LOGS.bat` (il a un `pause` à la fin)

### "Je vois plein de fenêtres cmd/Python"

Plusieurs processus Python peuvent tourner. Celui du backend affiche :
```
INFO:     Uvicorn running on http://0.0.0.0:8001
```

---

## 🎯 Récapitulatif

| ❌ PAS ICI | ✅ ICI |
|-----------|--------|
| Navigateur (http://localhost:8001) | Fenêtre PowerShell/cmd |
| http://localhost:8001/docs | Console où backend tourne |
| http://localhost:8001/logs | Terminal avec "Uvicorn running" |
| Frontend (localhost:5173) | Fenêtre "Backend API" |

---

## 🚀 Action Immédiate

### Méthode Simple (Recommandée) :

1. **Fermez** le backend actuel (s'il tourne)
   - Dans la fenêtre backend : `Ctrl + C`
   - Ou fermez la fenêtre

2. **Double-cliquez** sur :
   ```
   START_BACKEND_LOGS.bat
   ```

3. **Laissez cette fenêtre OUVERTE**

4. **Allez sur le frontend** (http://localhost:5173)

5. **Générez une route**

6. **Revenez à la fenêtre du backend**
   - Les logs sont là ! 📋

7. **Copiez-collez les logs** ici

---

## 📸 Ce Que Vous Devriez Voir

### Avant de générer :
```
INFO:     Application startup complete.
█  ← Curseur qui clignote
```

### Pendant la génération :
```
INFO:     127.0.0.1:52394 - "POST /route HTTP/1.1" 200 OK

=== ROUTE GENERATION START ===
...
```

### Après la génération :
```
=== RESULTS ===
Total attempts: 40
Successful snaps (>20%): 8
Best route found: YES
█
```

---

**Double-cliquez sur `START_BACKEND_LOGS.bat` et les logs seront visibles ! 🎯**

