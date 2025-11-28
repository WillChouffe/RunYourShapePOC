# 🚶 Guide des Types de Réseaux OSM

## ✅ Configuration Actuelle : Mode "WALK"

L'application utilise **`osm_network_type: "walk"`** qui est **IDÉAL pour les parcours piétons !**

---

## 🗺️ Ce que le mode "WALK" inclut

### ✅ Chemins Piétons
- Trottoirs
- Passages piétons
- Zones piétonnes (rues fermées aux voitures)
- Chemins dans les parcs et jardins
- Sentiers pédestres
- Allées
- Escaliers publics
- Passerelles piétonnes

### ✅ Routes Accessibles à Pied
- Rues résidentielles
- Routes principales (avec trottoirs)
- Boulevards
- Avenues

### ❌ Exclu du mode "WALK"
- Autoroutes (interdites aux piétons)
- Voies rapides sans accès piéton
- Tunnels non-piétons

---

## 🔍 Comparaison des Modes

### 1. Mode "walk" 🚶 (ACTUEL)
```python
osm_network_type: "walk"
```

**Caractéristiques** :
- ✅ Tous chemins piétons
- ✅ Rues avec trottoirs
- ✅ Parcs et espaces verts
- ✅ Raccourcis piétons
- ❌ Pas d'autoroutes

**Usage** : Running, marche, randonnée urbaine

**Densité** : ⭐⭐⭐⭐⭐ (très dense en ville)

---

### 2. Mode "bike" 🚴
```python
osm_network_type: "bike"
```

**Caractéristiques** :
- ✅ Pistes cyclables
- ✅ Bandes cyclables
- ✅ Voies vertes
- ✅ Routes peu fréquentées
- ⚠️ Moins de chemins de parcs
- ❌ Pas d'escaliers

**Usage** : Vélo, VTT urbain

**Densité** : ⭐⭐⭐⭐ (bonne en ville)

---

### 3. Mode "drive" 🚗
```python
osm_network_type: "drive"
```

**Caractéristiques** :
- ✅ Toutes routes carrossables
- ✅ Autoroutes
- ✅ Voies rapides
- ⚠️ Moins de petites rues
- ❌ Pas de chemins piétons
- ❌ Pas de parcs

**Usage** : Voiture, utilitaires

**Densité** : ⭐⭐⭐ (réseau principal)

---

### 4. Mode "all" 🌐
```python
osm_network_type: "all"
```

**Caractéristiques** :
- ✅ TOUT : piéton + vélo + voiture
- ✅ Maximum de possibilités
- ⚠️ Peut inclure chemins non pertinents
- ⚠️ Téléchargement plus long

**Usage** : Tests, exploration

**Densité** : ⭐⭐⭐⭐⭐ (exhaustif)

---

## 🏃 Pourquoi "WALK" est Idéal pour le Running

### Avantages pour les coureurs :

1. **Variété de parcours**
   - Parcs et espaces verts
   - Quais et promenades
   - Rues piétonnes calmes

2. **Sécurité**
   - Évite les grandes routes dangereuses
   - Privilégie les zones piétonnes
   - Inclut les passages protégés

3. **Créativité**
   - Plus de chemins = plus de possibilités
   - Formes plus précises possibles
   - Accès à zones fermées aux véhicules

4. **Réalisme**
   - Routes réellement courables
   - Pas d'autoroutes interdites
   - Distances précises

---

## 🔄 Changer le Type de Réseau

Si vous voulez expérimenter, voici comment :

### 1. Modifier le fichier de configuration

Fichier : `backend/app/core/settings.py`

```python
# Ligne 17 - Changez "walk" par une autre valeur :
osm_network_type: str = "walk"  # Options : "walk", "bike", "drive", "all"
```

### 2. Redémarrer le backend

```powershell
# Arrêtez le backend (Ctrl+C)
# Relancez-le
cd backend
venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

### 3. Effacer le cache (important !)

Les graphes sont mis en cache. Pour tester un nouveau type :

```powershell
# Windows
rmdir /s /q backend\data\osm_cache

# Ou manuellement
Supprimer le dossier : backend/data/osm_cache/
```

Puis relancer la génération d'une route.

---

## 🧪 Tests Comparatifs

### Exemple : Paris, 5km, forme "heart"

| Mode | Chemins disponibles | Résultat |
|------|---------------------|----------|
| **walk** 🚶 | 15,000+ segments | ✅ Excellent (parcs inclus) |
| **bike** 🚴 | 8,000 segments | ✅ Bon (pistes cyclables) |
| **drive** 🚗 | 5,000 segments | ⚠️ Moyen (routes principales) |
| **all** 🌐 | 20,000+ segments | ✅ Maximum (mais lent) |

---

## 📊 Impact sur la Génération

### Mode "WALK" (actuel) :

**Avantages** :
- ✅ Plus de points de snap possibles
- ✅ Formes plus précises
- ✅ Accès aux parcs et espaces verts
- ✅ Meilleur pour zones urbaines denses

**Inconvénients** :
- ⚠️ Peut inclure des escaliers (non idéal pour vélo)
- ⚠️ Chemins parfois étroits

---

### Mode "BIKE" :

**Avantages** :
- ✅ Idéal pour cyclistes
- ✅ Évite les escaliers
- ✅ Pistes dédiées

**Inconvénients** :
- ❌ Moins de chemins en ville
- ❌ Pas d'accès aux zones piétonnes

---

### Mode "DRIVE" :

**Avantages** :
- ✅ Routes principales bien définies
- ✅ Bon pour grandes distances

**Inconvénients** :
- ❌ Beaucoup moins de chemins
- ❌ Pas adapté pour running
- ❌ Formes moins précises

---

## 🎯 Recommandations par Usage

| Usage | Mode Recommandé | Raison |
|-------|----------------|---------|
| **Running** 🏃 | **"walk"** ✅ | Chemins piétons + parcs |
| **Vélo urbain** 🚴 | "bike" | Pistes cyclables |
| **Vélo route** 🚴 | "bike" ou "drive" | Routes principales |
| **Exploration** 🗺️ | "all" | Maximum de possibilités |
| **Tests** 🧪 | "walk" | Meilleur compromis |

---

## 🔬 Détails Techniques OSM

### Ce que OpenStreetMap considère comme "walk" :

**Tags OSM inclus** :
```
highway=footway       (chemins piétons)
highway=path          (sentiers)
highway=pedestrian    (zones piétonnes)
highway=steps         (escaliers)
highway=living_street (rues résidentielles)
highway=residential   (rues avec trottoirs)
highway=service       (voies de service)
+ tous les "sidewalk=yes"
```

**Tags OSM exclus** :
```
highway=motorway      (autoroutes)
highway=trunk         (voies rapides)
access=no             (accès interdit)
```

---

## 💡 Cas d'Usage Spéciaux

### Pour un marathon (42km) :
```python
osm_network_type: "drive"  # Routes principales, moins de détours
```

### Pour un trail urbain :
```python
osm_network_type: "walk"   # Parcs et chemins de nature
```

### Pour un critérium vélo :
```python
osm_network_type: "bike"   # Circuit cycliste
```

### Pour explorer toutes possibilités :
```python
osm_network_type: "all"    # Maximum de routes
```

---

## ⚠️ Avertissements

### Si vous changez en "drive" :
- ❌ Vous perdrez les chemins de parcs
- ❌ Les formes seront moins précises
- ❌ Routes dangereuses pour coureurs

### Si vous changez en "bike" :
- ⚠️ Moins de chemins qu'en "walk"
- ⚠️ Pas d'escaliers (bon pour vélo, limitant pour formes)

### Si vous changez en "all" :
- ⚠️ Téléchargement OSM plus long
- ⚠️ Peut générer routes impraticables
- ⚠️ Calculs plus lents

---

## 📋 Checklist de Changement

Si vous voulez changer le mode :

- [ ] Modifier `backend/app/core/settings.py` ligne 17
- [ ] Supprimer le cache : `backend/data/osm_cache/`
- [ ] Redémarrer le backend
- [ ] Tester avec une ville connue
- [ ] Comparer les résultats

---

## ✅ Conclusion

**Configuration actuelle : `"walk"` ✅**

C'est le **MEILLEUR choix** pour :
- ✅ Running / Course à pied
- ✅ Marche / Randonnée urbaine
- ✅ Exploration de villes
- ✅ Formes précises

**Les chemins piétons SONT pris en compte !** 🚶

L'application utilise déjà tous les :
- Sentiers de parcs
- Chemins piétons
- Zones piétonnes
- Allées
- Passages

**Vous n'avez rien à changer, c'est déjà optimal ! 🎯**

---

**Question répondue : OUI, l'app prend en compte les parcours piétons, c'est même son mode par défaut !** 🚶‍♂️

