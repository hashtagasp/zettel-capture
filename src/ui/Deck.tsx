import { useEffect, useRef, useState } from 'preact/hooks'
import type { Card } from '../lib/cards'
import { LANES } from '../lib/lanes'

interface DeckProps {
  index: number
  onIndexChange: (index: number) => void
  cardsByLane: Card[][]
  onOpenCard: (laneIndex: number, card: Card) => void
  onOpenList: (laneIndex: number) => void
  loading: boolean
}

/** Fraction of the viewport a drag must cross to change lane. */
const COMMIT_RATIO = 0.22
/** px/ms — a quick flick commits regardless of distance. */
const FLICK_VELOCITY = 0.45
/** Rubber-banding when dragging past the first or last lane. */
const OVERSCROLL = 0.28

export function Deck({
  index,
  onIndexChange,
  cardsByLane,
  onOpenCard,
  onOpenList,
  loading,
}: DeckProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState(0)
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
    track.style.transition = drag === 0 ? 'transform 260ms cubic-bezier(0.2,0.8,0.2,1)' : 'none'
    track.style.transform = `translate3d(${-index * width() + drag}px,0,0)`
  }, [index, drag])

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
      // Bias towards horizontal: lane switching is the primary gesture, and a
      // thumb arc across a phone is never perfectly straight.
      g.axis = Math.abs(dx) > Math.abs(dy) * 0.8 ? 'x' : 'y'
      if (g.axis === 'x') (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    }

    if (g.axis !== 'x') return
    event.preventDefault()

    const atEdge = (dx > 0 && index === 0) || (dx < 0 && index === LANES.length - 1)
    setDrag(atEdge ? dx * OVERSCROLL : dx)
  }

  const onPointerUp = (event: PointerEvent) => {
    const g = gesture.current
    if (!g || event.pointerId !== g.pointerId) return
    gesture.current = null

    const dx = event.clientX - g.startX
    const dy = event.clientY - g.startY
    const elapsed = Math.max(1, event.timeStamp - g.startTime)

    if (g.axis === 'y') {
      // A deliberate upward flick fans the deck into a full list.
      if (dy < -60 && Math.abs(dy) > Math.abs(dx)) onOpenList(index)
      return
    }
    if (g.axis !== 'x') return

    const velocity = dx / elapsed
    const committed =
      Math.abs(dx) > width() * COMMIT_RATIO || Math.abs(velocity) > FLICK_VELOCITY
    const direction = dx < 0 ? 1 : -1
    const next = committed
      ? Math.min(LANES.length - 1, Math.max(0, index + direction))
      : index

    setDrag(0)
    if (next !== index) onIndexChange(next)
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
  lane,
  loading,
  onOpen,
}: {
  cards: Card[]
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

  const [front, ...rest] = cards
  const behind = rest.slice(0, 2)

  return (
    <div class="stack">
      {behind[1] && <div class="stack-card behind-2" aria-hidden="true" />}
      {behind[0] && <div class="stack-card behind-1" aria-hidden="true" />}
      <button class="stack-card front" onClick={() => onOpen(front)}>
        <div class="card-body">
          {front.subtitle && <div class="card-date">{front.subtitle}</div>}
          <h2 class="card-title">{front.title}</h2>
          {front.preview && <div class="card-preview">{front.preview}</div>}
          {front.flag && <div class="card-flag">{front.flag}</div>}
        </div>
      </button>
    </div>
  )
}
