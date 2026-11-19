# homebridge-bambu-lab

Plugin Homebridge qui expose la caméra des imprimantes Bambu Lab dans HomeKit (direct basse latence : flux H.264 de l'imprimante transmis sans réencodage, réencodage seulement pour les petites résolutions). Aucune autre fonction (plus de MQTT depuis la 2.0). Publié sur npm sous `@moifort/homebridge-bambu-lab` (compte npm : moifort). Fork de trinityhades/homebridge-bambu-lab — le paquet npm d'origine `homebridge-bambu-lab` appartient à trinityhades, ne pas publier dessus.

## Commandes

- `npm run build` — compile (rimraf + tsc)
- `npm run lint` — ESLint typé, zéro warning toléré
- `npm test` — tests unitaires (`node:test`, compilés par `tsc` dans `.test-dist`)
- `npm version <patch|minor|major> && git push --follow-tags` — release (déclenche la publication npm)

## Déploiement

La publication npm est automatique : un tag `v*` poussé sur GitHub déclenche `.github/workflows/publish.yml` (OIDC Trusted Publishing, pas de token). `npm version` crée le commit de version et le tag.

## Routine « push sur ce projet »

Quand l'utilisateur dit « push sur ce projet » (ou équivalent), exécuter dans l'ordre :

1. **Changelog** : déplacer le contenu de la section `[Unreleased]` de `CHANGELOG.md` vers une nouvelle section de version datée (format Keep a Changelog). Si `[Unreleased]` est vide, la remplir d'abord à partir des changements en attente.
2. **README** : mettre à jour `README.md` si les changements ajoutent/modifient des fonctionnalités ou des options de configuration visibles par l'utilisateur.
3. **Vérifier** : `npm run build && npm run lint && npm test` doivent passer.
4. **Commit** : commiter tous les changements en attente (message conventional commits).
5. **Version** : déterminer l'incrément selon les changements depuis la dernière version — `fix`/chore → patch, nouvelle fonctionnalité → minor, breaking change → major — puis `npm version <increment>` et `git push --follow-tags` (déclenche la publication npm automatique).
