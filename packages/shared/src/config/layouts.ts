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

  /** Lag shot: both balls start on the head string, this far either side of the centre line (m). */
  lagOffset: 0.3,
} as const;
