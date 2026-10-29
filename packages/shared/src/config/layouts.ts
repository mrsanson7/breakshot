/**
 * Starting positions, as fractions of the playing area (x along the length, y across) plus
 * absolute offsets in metres. The "head" end is x = 0 (left on screen).
 */
export const LAYOUT = {
  /** Head spot / head string at 1/4 of the length (2nd long-rail diamond). */
  headStringX: 0.25,
  /** Foot spot at 3/4 of the length. */
  footSpotX: 0.75,
  /** Centre spot. */
  centreX: 0.5,
  /** Long axis. */
  centreY: 0.5,

  /** UMB opening: breaker's ball on the head string this far from the head spot (m). TODO(확인 필요) */
  caromBreakOffset: 0.182,

  /**
   * PBA opening spots 1–9 as fractions of the playing area (x along the length from the head
   * rail, y across). PBA: the breaker's ball goes on spot 1–3, the opponent's ball on 4–6 and the
   * red on 7–9; the formation is drawn by card after the lag (or fixed by the organiser, e.g.
   * 2-4-8, 3-5-8, 3-5-7) and kept for the whole match.
   * TODO(확인 필요): the spot coordinates below are assumptions (the official spot diagram could not
   * be found). 2-4-8 is laid out to equal the UMB opening.
   */
  pbaSpots: {
    1: { x: 0.25, y: 0.75 },
    2: { x: 0.25, y: 0.5 + 0.182 / 1.42 },
    3: { x: 0.25, y: 0.5 - 0.182 / 1.42 },
    4: { x: 0.25, y: 0.5 },
    5: { x: 0.1875, y: 0.5 },
    6: { x: 0.3125, y: 0.5 },
    7: { x: 0.6875, y: 0.5 },
    8: { x: 0.75, y: 0.5 },
    9: { x: 0.8125, y: 0.5 },
  } as Record<number, { x: number; y: number }>,

  /** Lag shot: both balls start on the head string, this far either side of the centre line (m). */
  lagOffset: 0.3,
} as const;
