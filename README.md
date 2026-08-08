# Zettel Capture

Eine installierbare Web-App (PWA), um unterwegs Eingangs- und Quellennotizen in
den Zettelkasten unter `96_Obsidian_Structure` zu schreiben.

Sie ist **kein Obsidian-Client**. Sie rendert kein Markdown zum Bearbeiten,
löst keine Links auf und synchronisiert den Vault nicht herunter. Sie tippt,
fotografiert und schreibt eine korrekt geformte `.md`-Datei nach GitHub. Genau
diese Beschränkung hält sie klein genug, um wartungsfrei zu bleiben.

## Was sie schreibt — und was nicht

| Lane | Ordner | |
|---|---|---|
| Eingang | `00_Eingang` | legt neue Notizen an |
| Quellen | `30_Quellen` | hängt Zitate an **vorhandene** Quellennotizen an |
| Zettel | `10_Zettel` | nur lesen |
| Struktur | `20_Struktur` | nur lesen |
| Projekte | `40_Projekte` | nur lesen |

`30_Quellen` verlangt `Q <Autor> <Jahr> – <Titel>.md`. Diesen Namen kann ein
Handy-Capture nicht erfinden, ohne drei Felder abzufragen — deshalb **erzeugt
die App dort nie eine Datei**, sondern wählt eine vorhandene Quelle und spleißt
das Zitat in deren `## Zitate`-Abschnitt. Ist die Quelle noch nicht im Vault,
landet die Notiz in `00_Eingang` mit einem `## Quellenangabe`-Feld zum Nachtragen.

`10_Zettel` ist bewusst nicht beschreibbar. Regel 3 der Legende verlangt, dass
jeder neue Zettel am selben Tag in einen Strukturzettel eingetragen wird — das
ist Schreibtischarbeit.

## Einrichtung (einmalig, kostet nichts)

**1. Vault zu einem Git-Repo machen**

```sh
cd ~/Desktop/Body/Lab/96_Obsidian_Structure
cp ../98_Zettel_Capture/vault.gitignore .gitignore
git init && git add -A && git commit -m "Zettelkasten"
```

**2. Privates Repo auf GitHub anlegen** (kostenlos, unbegrenzt) und pushen:

```sh
git remote add origin git@github.com:<konto>/zettelkasten.git
git branch -M main && git push -u origin main
```

**3. Obsidian Git installieren** — Community-Plugin, kostenlos. *Nicht*
Obsidian Sync, das kostet Geld und wird hier nicht gebraucht. Einstellungen:
„Pull on startup" an, Auto-Pull alle 10 Minuten.

**4. Token erzeugen** — GitHub → Settings → Developer settings → *Fine-grained
tokens*. Nur auf das Vault-Repo beschränken, Berechtigung
`Contents: read and write`. Sonst nichts.

**5. App veröffentlichen** — dieses Verzeichnis in ein **öffentliches** Repo
pushen und GitHub Pages aktivieren (Pages auf privaten Repos setzt einen
Bezahlplan voraus; im Quelltext steht kein Geheimnis, der Token wird erst zur
Laufzeit eingegeben und verlässt das Handy nie).

```sh
npm install && npm run build     # Ergebnis in dist/
```

Heißt das Repo nicht `zettel-capture`, den Basispfad mitgeben:
`BASE_PATH=/mein-repo/ npm run build`.

**6. Auf dem Handy** — Pages-URL in Chrome öffnen → Menü → *App installieren* →
Konto, Repo, Branch und Token eintragen.

## Bedienung

- Links/rechts wischen wechselt die Lane, nach oben wischen fächert den Stapel
  zu einer Liste auf.
- **+** unten rechts legt an. Auf der Quellen-Lane fragt es zuerst, zu welcher
  Quelle.
- **Foto** verkleinert auf 1600 px / q0.8 (~300 kB statt ~3 MB), legt es in
  `Anhang/` ab und setzt `![[…]]` in die Notiz. Ohne das Verkleinern wäre das
  Repo binnen eines Jahres unangenehm groß, und Git vergisst nie.
- `[[` schlägt Dateinamen aus `10_Zettel` und `20_Struktur` vor.
- Der Punkt oben rechts ist der Sync-Status: gefüllt = alles übertragen, hohl
  mit Zahl = wartet. Antippen öffnet die Verbindungseinstellungen.
- Das Icon lange drücken: *Neue Eingangsnotiz* und *Foto zu Quelle* direkt vom
  Launcher. Aus jeder App heraus teilen legt ebenfalls eine Eingangsnotiz an.

## Warum nichts verloren geht

Eine Notiz liegt in IndexedDB, bevor irgendetwas das Netz berührt — gespeichert
300 ms nach dem letzten Tastendruck, nicht erst beim Sichern. Das Hochladen ist
eine Warteschlange darüber, mit Backoff (30 s → 2 min → 8 min → 32 min → 2 h)
und einem Background-Sync-Handler im Service Worker, der auch bei geschlossener
App überträgt. Nichts ist je nur unterwegs.

Ein harter Fehler (abgelaufener Token, falsches Repo) parkt die Notiz sichtbar
in den Einstellungen statt sie endlos zu wiederholen; „Erneut versuchen" holt
sie ab, sobald der Token stimmt.

## Tests

```sh
npm test
```

`tests/verify.ts` prüft Dateinamen, Frontmatter und das Einspleißen von Zitaten
gegen die **echten** Dateien in `96_Obsidian_Structure` — unter anderem, dass
`Q Rand 1957 – Atlas Shrugged.md` (hat kein `## Zitate`, sondern `## Stellen`)
korrekt behandelt wird und der Dataview-Block am Dateiende unangetastet bleibt.

`tests/sync.test.ts` fährt die Warteschlange gegen ein nachgebautes GitHub:
Foto vor Notiz, Umlaute und Halbgeviertstrich über den ganzen Weg, Offline-Fall,
toter Token, und zwei Notizen in derselben Minute ohne Überschreiben.
