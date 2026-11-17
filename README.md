# git-pull-guard

Ein Claude-Code-Mod, der dafür sorgt, dass du nicht auf einem veralteten Stand weiterarbeitest. Beim Start einer Session in einem Git-Projekt holt er den Stand vom Server (`git fetch`) und vergleicht ihn mit deinem Branch:

- **Nur hinter dem Server, keine eigenen Änderungen oder Commits:** Er holt die neuen Commits selbst (`fast-forward`, es wird nichts zusammengeführt) und meldet kurz „↓ 3 Commits auf main geholt“.
- **Hinter dem Server, aber mit lokalen Änderungen oder eigenen Commits:** Er pullt nicht. Über dem Prompt erscheint „⚠ main ist 2 Commits hinter origin/main. Erst pullen!“ mit den Buttons **Jetzt pullen** (nur wenn gefahrlos möglich), **Claude fragen** (schreibt eine fertige Bitte ins Eingabefeld) und **Ausblenden**. Claude bekommt zusätzlich den Hinweis, dich zu erinnern und vorher keine Dateien in diesem Repo zu bearbeiten.
- **Vor `git push`:** Will Claude per Bash pushen, prüft er erneut. Ist der Branch inzwischen hinter dem Server, hält er den Push an und sagt Claude, erst zu pullen.
- **Arbeit auf `main`:** Will Claude in einem Repo auf `main` oder `master` die erste Datei ändern, hält der Mod das einmal an. Claude fragt dich dann, ob es erst einen eigenen Branch anlegen soll. Über dem Prompt stehen **Erst Branch anlegen** und **Auf main weiter**.
- **Ungepushte Commits:** Nach jeder Antwort zeigt er „↑ 2 Commits auf main noch nicht gepusht“ mit **Claude pushen lassen** und **Ausblenden**.
- **Lange Sessions:** Beim ersten Prompt nach 15 Minuten wird im Hintergrund neu geprüft.
- **Still** bleibt er, wenn alles aktuell ist, ohne Upstream, ohne Netz, bei abgekoppeltem HEAD und im Home-Ordner.

Git fragt dabei nie nach einem Passwort: Ein Abruf, der eins bräuchte, schlägt still fehl. Geprüft wird das Repo, in dem die Session gestartet wurde, nicht ein Ordner, in den mittendrin gewechselt wird.

## Einstellungen

| Option | Standard | Bedeutung |
| --- | --- | --- |
| `autoPull` | an | gefahrlose Fast-Forwards selbst holen; aus = nur warnen |
| `recheckMinutes` | 15 | nach wie vielen Minuten ein Prompt neu prüft (0 = nur beim Start) |
| `protectedBranches` | `main, master` | Branches, auf denen Claude vor der ersten Änderung nachfragt (leer = aus) |
| `ignore` | leer | komma-getrennte Repo-Namen oder Pfade, die er in Ruhe lässt, z. B. `dotfiles, ~/Projekte/alt` |

Setzen lassen sie sich beim Installieren oder später in `/config`.

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
