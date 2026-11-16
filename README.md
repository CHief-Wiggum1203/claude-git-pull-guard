# git-pull-guard

Ein Claude-Code-Mod, der dafür sorgt, dass du nicht auf einem veralteten Stand weiterarbeitest. Beim Start einer Session in einem Git-Projekt holt er den Stand vom Server (`git fetch`) und vergleicht ihn mit deinem Branch:

- **Nur hinter dem Server, keine eigenen Änderungen oder Commits:** Er holt die neuen Commits selbst (`fast-forward`, es wird nichts zusammengeführt) und meldet kurz „↓ 3 Commits auf main geholt“.
- **Hinter dem Server, aber mit lokalen Änderungen oder eigenen Commits:** Er pullt nicht. Über dem Prompt erscheint „⚠ main ist 2 Commits hinter origin/main. Erst pullen!“ mit den Buttons **Jetzt pullen** (nur wenn gefahrlos möglich), **Claude fragen** (schreibt eine fertige Bitte ins Eingabefeld) und **Ausblenden**. Claude bekommt zusätzlich den Hinweis, dich zu erinnern und vorher keine Dateien in diesem Repo zu bearbeiten.
- **Still** bleibt er, wenn alles aktuell ist, ohne Upstream, ohne Netz, bei abgekoppeltem HEAD und im Home-Ordner.

Git fragt dabei nie nach einem Passwort: Ein Abruf, der eins bräuchte, schlägt still fehl. Geprüft wird beim Start einer Session, nicht bei einem Ordnerwechsel mittendrin.

Braucht Claude Code 2.1.325 oder neuer.

## Installieren

Am Prompt einer Terminal-Session:

```
/plugin install git-pull-guard --marketplace CHief-Wiggum1203/claude-git-pull-guard
```

`y` bestätigt den Marketplace, dann einen Scope wählen.

Aus einer Shell:

```bash
claude plugin install git-pull-guard --marketplace CHief-Wiggum1203/claude-git-pull-guard
```

In der Desktop-App: neben dem Prompt auf **+** klicken, dann **Plugins**, **Add marketplace** mit `CHief-Wiggum1203/claude-git-pull-guard`, dann **Add plugin**.
