# dsh-better-workspaces

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [Français](README.fr.md) · [한국어](README.ko.md)

Worktrees, diffs, pull requests et issues directement dans l'interface web de DeepSeek Harness. Une conversation reste concentrée sur un changement, du premier message au commit, sans changer d'onglet.

![Sélecteur Local et New worktree au-dessus du composeur](docs/screenshots/01-worktree-mode.png)

**1 · Choisir le lieu du travail.** Le composeur propose `Local` et `New worktree`. Pour une correction rapide, gardez `Local`. Pour un changement qui mérite sa propre branche et son propre répertoire, choisissez `New worktree`.

![Formulaire worktree avec nom de branche, choix de la base et bouton Create](docs/screenshots/02-worktree-form.png)

**2 · Nommer, choisir une base, créer.** Saisissez un nom de branche ou lancez le dé. La base peut être une branche locale, une branche distante ou une pull request. Create ouvre le worktree comme espace de travail autonome, avec une session prête.

![Ligne de session avec branche et taille du diff](docs/screenshots/03-sidebar-badges.png)

**3 · Lire l'état de chaque session d'un coup d'œil.** La branche et la taille du changement apparaissent sous le titre de la session. Les PR et les vérifications rejoignent la même ligne lorsqu'elles existent.

![Page de diff avec périmètres, fichiers, hunks et actions](docs/screenshots/04-diff-view.png)

**4 · Relire le changement entier sur une page.** Le bouton `±` ouvre la page de diff dans la barre latérale droite. Passez des modifications non validées à la session, à la tâche ou à la comparaison avec la base. Dépliez un fichier pour voir les hunks, modifiez-le sur place ou consultez la liste des commits.

![Bouton Commit et menu More avec pull, push, PR, fusion, mise à jour et abandon](docs/screenshots/05-diff-actions.png)

**5 · Livrer sans quitter la page.** Commit, pull, push, création d'une PR, fusion, mise à jour depuis la base ou abandon des modifications. Les actions indisponibles indiquent ce qui manque.

![Sélecteur GitHub listant les pull requests et issues ouvertes](docs/screenshots/06-github-picker.png)

**6 · Ajouter une PR ou une issue au brouillon.** Le bouton GitHub du composeur liste les pull requests et issues ouvertes du dépôt courant. Choisissez une entrée pour l'ajouter comme référence.

![Composeur avec une puce de référence d'issue compacte et le bouton d'envoi](docs/screenshots/07-reference-chip.png)

**7 · Garder le brouillon compact.** Une seule petite puce apparaît dans le composeur. À l'envoi, elle se déploie en titre complet, lien, base/head et corps : le modèle reçoit le contexte exact.

## Installation

```bash
dsh plugin --profile web add github:ds-hu/dsh-better-workspaces
```

Redémarrez `dsh --profile web` une fois. Nécessite dsh ≥ 0.2.0, Node.js ≥ 20.19, `pnpm` dans le `PATH` et git. Les fonctions PR et issue utilisent aussi une CLI `gh` authentifiée ; le reste fonctionne sans elle.

## Utilisation

1. Ouvrez un espace de travail git et démarrez une session.
2. Choisissez `Local` ou `New worktree` dans le composeur.
3. Utilisez `±` pour relire, `Commit` / `More` pour livrer, et le bouton GitHub pour attacher une PR ou une issue.

## Remarques

- Fonctionne sous Linux, macOS 13+ et Windows 10+.
- `gh` est facultatif. Sans lui, les worktrees, les badges et la page de diff restent disponibles.
- Toutes les actions restent dans l'onglet courant.

## Documentation

Architecture, décisions de conception, sécurité, développement et exploitation : [docs/TECHNICAL.md](docs/TECHNICAL.md). Les décisions de conception sont dans [docs/adr/](docs/adr/).

## Licence

MIT. Les notices tierces sont fournies dans [NOTICE](NOTICE) et [LICENSES/](LICENSES/).
