import type { Card } from '../lib/cards'

interface ListSheetProps {
  title: string
  cards: Card[]
  onOpen: (card: Card) => void
  onClose: () => void
}

/** The fanned-out deck: everything in one folder, newest first. */
export function ListSheet({ title, cards, onOpen, onClose }: ListSheetProps) {
  return (
    <div class="sheet">
      <div class="sheet-bar">
        <button class="link-button" onClick={onClose}>
          Zurück
        </button>
        <span class="title">
          {title} · {cards.length}
        </span>
        <span class="link-button" style="opacity:0">
          Zurück
        </span>
      </div>

      <div class="sheet-body">
        {cards.length === 0 && <p class="note">Nichts vorhanden.</p>}
        <div class="rows">
          {cards.map((card) => (
            <button class="row" key={card.key} onClick={() => onOpen(card)}>
              <div class="primary">{card.title}</div>
              <div class="secondary">
                {card.flag ?? card.subtitle}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
