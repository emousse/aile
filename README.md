# Aile

**Le Web, à ton rythme.**

Aile est un prototype de lecture du Web pensé pour les enfants de 9 à 12 ans, accompagnés d’un adulte. L’idée : laisser la curiosité guider la navigation, avec une page lisible et une aide pour comprendre les passages difficiles.

Une recherche ou une adresse suffit pour ouvrir une page. Son contenu principal est extrait, puis affiché dans une interface adaptée au mobile. Le texte de la source reste au centre ; l’IA apporte des repères et des explications séparées du contenu.

## Trois outils de lecture

- **Comprendre** : sélectionner un passage et demander une explication, avec un retour direct au texte source.
- **Explorer** : poursuivre la lecture à travers trois liens au maximum, issus de la page.
- **Examiner** : consulter la provenance, les métadonnées disponibles et accéder à l’original.

La recherche utilise Wikipédia par défaut, ou Brave si une clé est configurée. Sans configuration IA, la lecture et la navigation restent disponibles.

## Choix techniques

Le projet associe **React, TypeScript et Vite** pour l’interface, **Fastify et Zod** pour l’API, et **Mozilla Readability** pour l’extraction des articles. L’aide IA utilise l’API OpenAI avec des réponses structurées.

L’extraction s’exécute dans un worker avec des limites de ressources. Les scripts des pages ne sont pas exécutés ; les accès aux adresses privées et les redirections sont contrôlés côté serveur. Les références aux passages et aux images sont signées.

Aile fonctionne sans compte utilisateur ni base de données. L’historique de navigation reste en mémoire dans l’onglet. Des tests Vitest et Playwright couvrent notamment l’extraction, l’API, les protections réseau, la navigation et l’accessibilité. Un Dockerfile et un workflow GitHub Actions sont inclus.

## Lancer en local

Prérequis : Node.js 24 et npm.

```sh
nvm install
nvm use
npm ci
cp .env.example .env
npm run dev
```

L’application est accessible sur [http://127.0.0.1:5173](http://127.0.0.1:5173).

Dans `.env`, renseigner `OPENAI_API_KEY` et `OPENAI_MODEL` pour activer l’aide IA, et `BRAVE_SEARCH_API_KEY` pour la recherche Web. Les autres options sont décrites dans [`.env.example`](.env.example).

## Vérifier et construire

```sh
npm run check               # TypeScript, tests unitaires et build
npx playwright install chromium
npm run test:e2e            # Tests navigateur
npm run test:production     # Vérification du serveur compilé
```

Pour servir le build : `npm run build`, puis `NODE_ENV=production npm start`. Configurer `PUBLIC_ORIGIN`, `SIGNING_SECRET` et `PILOT_PASSWORD` dans `.env`, et placer le serveur derrière HTTPS. L’accès utilise l’identifiant `pilote`.

## État du projet

Aile est une version d’essai centrée sur les pages documentaires publiques. Les sites interactifs ne sont pas restitués comme dans un navigateur complet. La compatibilité Safari/iOS, les usages avec des enfants et le comportement sous charge restent à évaluer. Une explication IA peut se tromper ; Aile ne vérifie pas la vérité des sources et ne constitue pas un contrôle parental.
