# dsh-better-workspaces

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [Français](README.fr.md) · [한국어](README.ko.md)

Worktrees Git, visualisation complète des diffs, pull requests et tickets d'issues directement dans l'interface web de DeepSeek Harness. Isolez chaque tâche dans sa propre branche et son propre répertoire : de la première invite au commit final, tout s'effectue sans quitter la page ni ouvrir de terminal.

---

## Fonctionnalités

### 1. Sélection du mode de travail dans le composeur

Basculez entre `Local` et `New worktree` directement au-dessus de la zone de saisie. Conservez `Local` pour des ajustements ponctuels ; basculez vers `New worktree` dès qu'une tâche nécessite sa propre branche et un répertoire isolé, éliminant tout risque de conflit entre travaux parallèles.

![Sélecteur Local et New worktree au-dessus du composeur](docs/screenshots/01-worktree-mode.png)

### 2. Création rapide depuis une branche ou une PR

Renseignez un nom de branche ou générez-en un d'un clic grâce au dé. Choisissez votre base parmi les branches locales, distantes ou les pull requests ouvertes. Un clic sur **Create** initialise immédiatement un espace de travail dédié avec une session opérationnelle.

![Formulaire worktree avec nom de branche, choix de la base et bouton Create](docs/screenshots/02-worktree-form.png)

### 3. Suivi de l'état Git au niveau de chaque session

Sous le titre de chaque session dans la barre latérale, retrouvez la branche active et le volume de changements (`+11 −3`). Les statuts de pull request et de CI s'affichent sur la même ligne : inutile d'exécuter `git status` en ligne de commande.

![Ligne de session avec branche et taille du diff](docs/screenshots/03-sidebar-badges.png)

### 4. Revue intégrale des diffs dans le volet latéral

Cliquez sur le badge `±` pour déployer le panneau de diff. Passez en un instant des modifications non validées aux changements de la session, au périmètre global de la tâche ou à la comparaison avec la branche de base. Examinez les hunks ligne par ligne, éditez les fichiers directement en place et consultez l'historique des commits.

![Page de diff avec périmètres, fichiers, hunks et actions](docs/screenshots/04-diff-view.png)

### 5. Opérations Git sans quitter l'interface

Exécutez vos commandes courantes directement depuis le panneau de diff : Commit, Pull, Push, ouverture de PR, fusion, mise à jour depuis la base ou abandon des modifications. Les actions non disponibles détaillent clairement le prérequis manquant.

![Bouton Commit et menu More avec pull, push, PR, fusion, mise à jour et abandon](docs/screenshots/05-diff-actions.png)

### 6. Rattachement rapide de PR et d'issues

Le bouton GitHub situé à côté du composeur dresse la liste des pull requests et des issues ouvertes du dépôt. Sélectionnez l'élément souhaité pour l'insérer directement dans votre message comme référence structurée.

![Sélecteur GitHub listant les pull requests et issues ouvertes](docs/screenshots/06-github-picker.png)

### 7. Puce compacte et déploiement exhaustif du contexte

Le composeur reste dégagé grâce à une puce discrète qui n'encombre pas l'espace d'écriture. Lors de l'envoi, elle est automatiquement déployée avec le titre intégral, le corps du ticket, les informations de branche et l'URL, transmettant au modèle un contexte précis et complet.

![Composeur avec une puce de référence d'issue compacte et le bouton d'envoi](docs/screenshots/07-reference-chip.png)

---

## Flux de travail rapide

1. **Démarrer une session :** Ouvrez un espace de travail Git dans DeepSeek Harness.
2. **Définir la portée :** Choisissez `Local` pour une modification directe ou `New worktree` pour une branche isolée.
3. **Développer et réviser :** Référencez vos tickets avec le sélecteur GitHub, suivez l'avancement via les badges latéraux et cliquez sur `±` pour examiner le diff ligne par ligne.
4. **Livrer :** Validez, poussez ou ouvrez une pull request directement depuis la vue des modifications.

---

## Installation

Installez depuis npm avec une seule commande :

```bash
dsh plugin --profile web add @ds-hu/dsh-better-workspaces
```

Redémarrez `dsh --profile web` une fois pour finaliser l'activation.

Vous pouvez aussi installer le plugin depuis l'interface Web de DSH :

1. Ouvrez **Plugins** dans la barre latérale.
2. Cliquez sur **Add plugin**.
3. Saisissez `@ds-hu/dsh-better-workspaces` et choisissez **Official npm registry** comme source.
4. Cliquez sur **Install**, puis sur **Enable now** une fois l'installation terminée. Si un redémarrage est demandé, relancez `dsh --profile web`.

### Prérequis
- **DeepSeek Harness :** ≥ 0.2.0
- **Node.js :** ≥ 20.19
- **Outils :** `git`, `pnpm` (disponibles dans le `PATH`)
- **GitHub CLI (facultatif) :** Un client `gh` authentifié active la sélection directe des PR et issues. Les fonctionnalités de worktrees, badges et revues de diff restent pleinement utilisables sans lui.

---

## Remarques

- Compatible avec Linux, macOS 13+ et Windows 10+.
- L'ensemble des actions se déroule au sein de l'onglet actif du navigateur.

---

## Documentation

- [docs/TECHNICAL.md](docs/TECHNICAL.md) — Architecture technique, modèle de sécurité, remarques de mise à niveau et opérations manuelles.
- [docs/adr/](docs/adr/) — Registre des décisions d'architecture (ADR).

---

## Licence

[MIT](LICENSE). Les mentions relatives aux composants tiers figurent dans [NOTICE](NOTICE) et [LICENSES/](LICENSES/).
