/**
 * Frozen copies of the note shapes that actually occur in the vault.
 *
 * These existed as real files once and drove out real bugs. The vault is a
 * working document — it gets reorganised, emptied, started over — so the
 * regressions live here instead, where clearing a folder can't silently delete
 * the test that protects against them.
 */

/** The shape produced by 90_Meta/Templates/Quelle.md. */
export const QUELLE_WITH_ZITATE = `---
type: quelle
status: teilgelesen
author: Kees Dorst
year: 2017
title: Notes on Design. How Creative Practice Works
tags: [designtheorie, entwurfsprozess]
---

# Dorst 2017 – Notes on Design

**Vollbeleg:** Kees Dorst, *Notes on Design*, Amsterdam: BIS Publishers 2017.

## Zitate

> Designprobleme unterscheiden sich in ihrem Offenheitsgrad.

*S. 34.*

## Eigene Notizen

- Die Unterscheidung offen/eng entspricht den Freiheitsgraden der Improvisation.

## Daraus entstandene Zettel

\`\`\`dataview
LIST FROM "10_Zettel" WHERE contains(source, this.file.link)
\`\`\`
`

/**
 * `Q Rand 1957 – Atlas Shrugged.md` had no `## Zitate` at all — it collected
 * `## Stellen` instead. The first splice implementation appended a new section
 * *after* the trailing dataview block, which is structurally wrong.
 */
export const QUELLE_WITHOUT_ZITATE = `---
type: quelle
status: gelesen
author: Ayn Rand
year: 1957
title: Atlas Shrugged
tags: [ethik, rand, literatur, objektivismus]
---

# Rand 1957 – Atlas Shrugged

**Vollbeleg:** Ayn Rand, *Atlas Shrugged*, New York: Random House 1957.

> **Ausgabe prüfen.** Die Notizen referenzieren über Teil/Kapitel statt Seitenzahlen.

## Stellen

**The Face Without Pain or Fear or Guilt (2/9)** — Grundlage für [[202608021105 Ein moralisches System]].

## Eigene Notizen

- Dagny als eigentlicher Träger des Böse-Motivs, nicht die Antagonisten.

## Daraus entstandene Zettel

\`\`\`dataview
LIST FROM "10_Zettel" WHERE contains(source, this.file.link)
\`\`\`
`

/** A permanent Zettel, for the card-preview logic. */
export const ZETTEL = `---
id: 202608021015
type: zettel
status: grown
tags: [design, systemtheorie]
source:
follows-from:
  - "[[202608021050 In kreativen Berufen fehlt die Erfahrung]]"
contradicts: []
part-of:
  - "[[STR Systeme und Designpraxis]]"
---

# Design ist das Entwerfen von Systemen

Gutes Design ist wie gute Kunst: Es baut eine eigene Welt auf, in die man eintauchen kann. Der Unterschied liegt nicht im Ergebnis, sondern im Auftrag.

Eine Welt aufzubauen verlangt Regeln, die aufeinander abgestimmt sind.
`

/** Filenames following each of the four patterns in 00 Legende.md. */
export const FILENAMES = {
  zettel: '202608021015 Design ist das Entwerfen von Systemen.md',
  zettelUmlaut: '202608021010 Mit der Größe eines Systems wächst sein Repertoire.md',
  eingang: 'E 2026-08-08 Vorlesung Systemtheorie.md',
  struktur: 'STR Autopoiesis und Systemtheorie.md',
  quelle: 'Q Feige 2014 – Philosophie des Jazz.md',
}
