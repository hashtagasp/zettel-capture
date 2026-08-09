import { useEffect, useRef, useState } from 'preact/hooks'
import type { Card } from '../lib/cards'
import { LANES } from '../lib/lanes'

interface DeckProps {
  index: number
  onIndexChange: (index: number) => void
  cardsByLane: Card[][]
  /** Position within each lane's stack, one entry per lane. */
  cardIndex: number[]
  onCardIndexChange: (laneIndex: number, cardIndex: number) => void
  onOpenCard: (laneIndex: number, card: Card) => void
  loading: boolean
}

/** Fraction of the viewport a horizontal drag must cross to change lane. */
const COMMIT_RATIO = 0.22
/** px/ms — a quick flick commits regardless of distance. */
const FLICK_VELOCITY = 0.45
/** Pixels a vertical drag must cover to step to the next card. */
const STEP_DISTANCE = 64
/** Rubber-banding at either end of a lane or the lane list. */
const OVERSCROLL = 0.28

export function Deck({
  index,
  onIndexChange,
  cardsByLane,
  cardIndex,
  onCardIndexChange,
  onOpenCard,
  loading,
}: DeckProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragX, setDragX] = useState(0)
  const [dragY, setDragY] = useState(0)
  const gesture = useRef<{
    startX: number
    startY: number
    startTime: number
    axis: 'undecided' | 'x' | 'y'
    pointerId: number
  } | null>(null)

  const width = () => trackRef.current?.clientWidth ?? window.innerWidth

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    track.style.transition = dragX === 0 ? 'transform 260ms cubic-bezier(0.2,0.8,0.2,1)' : 'none'
    track.style.transform = `translate3d(${-index * width() + dragX}px,0,0)`
  }, [index, dragX])

  // Rotating the phone changes the page width; without this the track would
  // stay parked at the old offset and show two half lanes.
  useEffect(() => {
    const reposition = () => {
      const track = trackRef.current
      if (!track) return
      track.style.transition = 'none'
      track.style.transform = `translate3d(${-index * width()}px,0,0)`
    }
    addEventListener('resize', reposition)
    addEventListener('orientationchange', reposition)
    return () => {
      removeEventListener('resize', reposition)
      removeEventListener('orientationchange', reposition)
    }
  }, [index])

  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary) return
    gesture.current = {
      startX: event.clientX,
      startY: event.clientY,
      startTime: event.timeStamp,
      axis: 'undecided',
      pointerId: event.pointerId,
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    const g = gesture.current
    if (!g || event.pointerId !== g.pointerId) return

    const dx = event.clientX - g.startX
    const dy = event.clientY - g.startY

    if (g.axis === 'undecided') {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    }

    event.preventDefault()

    if (g.axis === 'x') {
      const atEdge = (dx > 0 && index === 0) || (dx < 0 && index === LANES.length - 1)
      setDragX(atEdge ? dx * OVERSCROLL : dx)
      return
    }

    const cards = cardsByLane[index] ?? []
    const at = cardIndex[index] ?? 0
    const atEnd = (dy < 0 && at >= cards.length - 1) || (dy > 0 && at === 0)
    setDragY(atEnd ? dy * OVERSCROLL : dy)
  }

  const onPointerUp = (event: PointerEvent) => {
    const g = gesture.current
    if (!g || event.pointerId !== g.pointerId) return
    gesture.current = null

    const dx = event.clientX - g.startX
    const dy = event.clientY - g.startY
    const elapsed = Math.max(1, event.timeStamp - g.startTime)

    if (g.axis === 'x') {
      const committed =
        Math.abs(dx) > width() * COMMIT_RATIO || Math.abs(dx / elapsed) > FLICK_VELOCITY
      const next = committed
        ? Math.min(LANES.length - 1, Math.max(0, index + (dx < 0 ? 1 : -1)))
        : index
      setDragX(0)
      if (next !== index) onIndexChange(next)
      return
    }

    if (g.axis === 'y') {
      const cards = cardsByLane[index] ?? []
      const at = cardIndex[index] ?? 0
      const committed =
        Math.abs(dy) > STEP_DISTANCE || Math.abs(dy / elapsed) > FLICK_VELOCITY
      // Dragging up moves deeper into the stack, the way scrolling a list does.
      const next = committed
        ? Math.min(cards.length - 1, Math.max(0, at + (dy < 0 ? 1 : -1)))
        : at
      setDragY(0)
      if (next !== at) onCardIndexChange(index, next)
    }
  }

  return (
    <div
      class="deck"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div class="deck-track" ref={trackRef}>
        {LANES.map((lane, laneIndex) => (
          <div class="deck-page" key={lane.id}>
            <Stack
              cards={cardsByLane[laneIndex] ?? []}
              at={cardIndex[laneIndex] ?? 0}
              dragY={laneIndex === index ? dragY : 0}
              lane={lane.label}
              loading={loading && laneIndex === index}
              onOpen={(card) => onOpenCard(laneIndex, card)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function Stack({
  cards,
  at,
  dragY,
  lane,
  loading,
  onOpen,
}: {
  cards: Card[]
  at: number
  dragY: number
  lane: string
  loading: boolean
  onOpen: (card: Card) => void
}) {
  if (cards.length === 0) {
    return (
      <div class="stack">
        <div class="empty">
          {loading ? <span>Lädt …</span> : <span>Noch nichts in {lane}.</span>}
        </div>
      </div>
    )
  }

  const position = Math.min(at, cards.length - 1)
  const front = cards[position]
  const behind = cards.slice(position + 1, position + 3)

  return (
    <div class="stack">
      {behind[1] && <div class="stack-card behind-2" aria-hidden="true" />}
      {behind[0] && <div class="stack-card behind-1" aria-hidden="true" />}
      <button
        // Keying on the card makes each step a fresh element, so the rise
        // animation replays instead of the text swapping in place.
        key={front.key}
        class={`stack-card front${dragY === 0 ? ' stepped' : ''}`}
        style={
          dragY === 0
            ? undefined
            : `transform:translateY(${dragY}px);opacity:${Math.max(0.35, 1 - Math.abs(dragY) / 320)}`
        }
        onClick={() => onOpen(front)}
      >
        <div class="card-body">
          {front.subtitle && <div class="card-date">{front.subtitle}</div>}
          <h2 class="card-title">{front.title}</h2>
          {front.preview && <div class="card-preview">{front.preview}</div>}
          {front.flag && (
            <div class={`card-flag${front.failed ? ' bad' : ''}`}>{front.flag}</div>
          )}
        </div>
      </button>
    </div>
  )
}
