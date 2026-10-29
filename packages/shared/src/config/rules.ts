/**
 * Rule-set numbers. Every value here is a default that the room creator can override
 * (within RULE_LIMITS) when creating a room.
 *
 * Sources: WPA World Standardized Rules (8-ball), UMB Billiards Rules (3-cushion),
 * PBA tour regulations (changes every season!), and common Korean hall practice (4-ball).
 * Values marked `TODO(확인 필요)` are listed in README → "확인 필요 목록".
 */

/** Shot clock / timeout settings shared by every rule set. 0 seconds disables the clock. */
export interface ClockConfig {
  /** Seconds per shot; 0 = no shot clock. */
  shotClock: number;
  /** Extensions (time-outs) available. Scope depends on the rule set (per game, set or rack). */
  timeouts: number;
  /** Seconds added by one extension. */
  extensionSeconds: number;
}

export interface EightBallConfig extends ClockConfig {
  /** Racks needed to win the match. */
  raceTo: number;
  /** Who breaks the next rack. WPA allows either by agreement. */
  breakRotation: 'alternate' | 'winner';
  /** Legal break: a ball pocketed or at least this many object balls driven to a cushion. */
  legalBreakMinRailBalls: number;
}

export interface ThreeCushionUmbConfig extends ClockConfig {
  /** Points to win the game. */
  targetPoints: number;
  /** UMB equal innings: if the starting player reaches the target, the opponent gets a last inning. */
  equalizingInning: boolean;
  /** UMB: the opening shot must hit the red ball first. */
  breakMustHitRedFirst: boolean;
}

/**
 * PBA bank shot ("뱅크샷").
 * Criterion used here: the cue ball contacts at least `minCushionsBeforeFirstBall` cushions
 * BEFORE touching the first object ball, and the shot is otherwise a valid 3-cushion point.
 * Such a point is worth `points` instead of 1.
 * TODO(확인 필요): confirm against the current PBA season regulations.
 */
export interface BankShotRule {
  enabled: boolean;
  minCushionsBeforeFirstBall: number;
  points: number;
}

export interface ThreeCushionPbaConfig extends ClockConfig {
  /** Points to win a set (all but the deciding set). */
  setPoints: number;
  /** Points to win the deciding set. */
  finalSetPoints: number;
  /** Sets needed to win the match (3 → best of 5). */
  setsToWin: number;
  bankShot: BankShotRule;
  /** Who breaks each new set. */
  setBreak: 'alternate' | 'loser';
  breakMustHitRedFirst: boolean;
  /** PBA opening formation (spots in LAYOUT.pbaSpots): drawn once per match, or fixed. */
  opening: PbaOpening;
}

export interface PbaOpening {
  mode: 'draw' | 'fixed';
  /** [breaker's ball 1–3, opponent's ball 4–6, red 7–9] — used when mode = 'fixed'. */
  spots: [number, number, number];
}

export interface FourBallConfig extends ClockConfig {
  /** Each player's target (handicap), in points (red-red hits). Index = player slot. */
  targets: [number, number];
  /** Points deducted for a foul (0 = no deduction). Varies by hall. */
  foulPenalty: number;
}

export interface RuleConfigs {
  wpa8: EightBallConfig;
  umb3c: ThreeCushionUmbConfig;
  pba3c: ThreeCushionPbaConfig;
  korean4: FourBallConfig;
}

export type RuleSetId = keyof RuleConfigs;

export const RULE_DEFAULTS: RuleConfigs = {
  wpa8: {
    raceTo: 3,
    breakRotation: 'alternate',
    legalBreakMinRailBalls: 4, // WPA 8-ball: at least four object balls to a cushion
    shotClock: 45, // WPA: 35 s + 1 extension in pro events; relaxed default for online play
    timeouts: 1, // per rack
    extensionSeconds: 30,
  },
  umb3c: {
    targetPoints: 40, // spec default; UMB World Cup uses 40
    equalizingInning: true,
    breakMustHitRedFirst: true,
    shotClock: 40, // UMB: 40 s
    timeouts: 2, // UMB: 2 extensions per player per game
    extensionSeconds: 40,
  },
  pba3c: {
    // TODO(확인 필요): PBA rules change every season — verify all numbers below.
    setPoints: 15,
    finalSetPoints: 11,
    setsToWin: 3,
    bankShot: { enabled: true, minCushionsBeforeFirstBall: 1, points: 2 },
    setBreak: 'alternate',
    // PBA: the breaker may play either object ball first (UMB requires the red).
    breakMustHitRedFirst: false,
    opening: { mode: 'draw', spots: [2, 4, 8] },
    shotClock: 35, // spec: "30초대"
    timeouts: 1, // per set
    extensionSeconds: 35,
  },
  korean4: {
    targets: [10, 10],
    foulPenalty: 0, // TODO(확인 필요): many halls deduct 1 point for a foul
    shotClock: 0,
    timeouts: 0,
    extensionSeconds: 0,
  },
};

/** Allowed ranges for room-creation overrides (server validates against these). */
export const RULE_LIMITS = {
  raceTo: { min: 1, max: 15 },
  targetPoints: { min: 1, max: 100 },
  setPoints: { min: 1, max: 50 },
  setsToWin: { min: 1, max: 7 },
  fourBallTarget: { min: 1, max: 100 },
  foulPenalty: { min: 0, max: 5 },
  shotClock: { min: 0, max: 300 },
  timeouts: { min: 0, max: 10 },
  extensionSeconds: { min: 0, max: 120 },
} as const;
