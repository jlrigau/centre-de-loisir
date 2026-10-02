# Notre centre de loisirs

Application web pour noter les centres de loisirs de Paris.

👉 **https://jlrigau.github.io/centre-de-loisir/**

## Le référentiel des centres

À Paris, les centres de loisirs (mercredis et vacances scolaires) sont accueillis dans les écoles
maternelles et élémentaires publiques. Il n'existe pas de jeu de données « centres de loisirs »
dédié : le référentiel est construit à partir du jeu
[`lieux-municipaux`](https://opendata.paris.fr/explore/dataset/lieux-municipaux/) de l'open data
de la Ville de Paris (catégories « Ecoles maternelles » et « Ecoles élémentaires », licence ODbL) :
nom, adresse, arrondissement, téléphone, coordonnées GPS, photo et lien vers la fiche paris.fr.

```sh
node scripts/fetch-data.mjs   # régénère data/centres.json
```

Le workflow `data.yml` relance cette extraction chaque lundi et republie le site si la liste a changé.

## Les votes

Trois mécanismes complémentaires, sur la fiche de chaque centre :

| Onglet | Ce qu'on fait | Règle |
| --- | --- | --- |
| ⭐ Avis | Note globale 1 à 5 étoiles, notes facultatives par critère (encadrement, activités, locaux & sécurité, communication), période fréquentée, commentaire | Un avis par famille et par centre, modifiable |
| 🎨 Activités | Proposer une activité (vécue ou souhaitée) et voter 👍 / 👎 | Un vote par famille et par activité |
| 📣 Événements | Signaler un super moment, une info utile ou un problème, daté | Les autres parents peuvent dire « moi aussi » |

La note moyenne colore les points de la carte (vert ≥ 4, orange ≥ 3, rouge en dessous, gris sans avis)
et permet de trier la liste. Pas de compte : un identifiant anonyme stocké dans le navigateur limite les doubles votes.

## Activer les votes partagés

GitHub Pages ne sert que des fichiers statiques : sans base de données, les votes restent dans le
navigateur de chacun (mode démo, signalé par un bandeau). Pour que tout le monde voie les mêmes votes :

1. Créer un projet gratuit sur [supabase.com](https://supabase.com).
2. Dans *SQL Editor*, exécuter [`supabase/schema.sql`](supabase/schema.sql).
3. Dans *Project Settings → API*, copier l'URL du projet et la clé publique `anon` dans [`config.js`](config.js).
4. Committer sur `main` : le site est republié automatiquement.

## Développement

```sh
python3 -m http.server 8080   # puis http://localhost:8080
```

Site 100 % statique (HTML, CSS, JavaScript sans build) ; carte avec [Leaflet](https://leafletjs.com)
et les fonds OpenStreetMap. Le workflow `pages.yml` publie la branche `main` sur la branche `gh-pages`.
