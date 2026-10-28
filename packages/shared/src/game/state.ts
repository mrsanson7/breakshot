import type { RuleConfigs, RuleSetId } from '../config/rules';
import type { TableId } from '../config/tables';
import type { BallPosition } from '../physics/types';
import type { PlacementRegion } from './placement';

/**
 * Game state machine shared by server and client.
 *
 *   WaitingPlayers → Aiming ⇄ BallInHand
 *   Aiming / BallInHand → Shooting → Simulating → Resolving → Aiming | BallInHand | SetOver | GameOver
 *   SetOver → Aiming | BallInHand            (next rack / set)
 *   Aiming / BallInHand → Resolving          (shot clock expired: no shot, the rules still judge)
 */
export type GamePhase =
  | 'WaitingPlayers'
  | 'Aiming'
  | 'Shooting'
  | 'Simulating'
  | 'Resolving'
  | 'BallInHand'
  | 'SetOver'
  | 'GameOver';

const TRANSITIONS: Record<GamePhase, readonly GamePhase[]> = {
  WaitingPlayers: ['Aiming', 'BallInHand'],
  Aiming: ['Shooting', 'Resolving', 'GameOver'],
  BallInHand: ['Shooting', 'Resolving', 'GameOver'],
  Shooting: ['Simulating'],
  Simulating: ['Resolving'],
  Resolving: ['Aiming', 'BallInHand', 'SetOver', 'GameOver'],
  SetOver: ['Aiming', 'BallInHand', 'GameOver'],
  GameOver: [],
};

export function canTransition(from: GamePhase, to: GamePhase): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: GamePhase, to: GamePhase): void {
  if (!canTransition(from, to)) throw new Error(`illegal phase transition ${from} → ${to}`);
}

export type Seat = 0 | 1;
export const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

export interface PlayerState {
  name: string;
  /** Points in the current game / set (carom). Unused by 8-ball. */
  score: number;
  /** Racks or sets won. */
  sets: number;
  /** Turns at the table (UMB "innings"). */
  innings: number;
  /** Points in the current run, and best run. */
  run: number;
  highRun: number;
  /** Extensions left (scope depends on the rule set). */
  timeoutsLeft: number;
}

export type BallGroup = 'solids' | 'stripes';

/** Rule-set specific state, discriminated by `kind`. */
export type RuleState =
  | { kind: 'eightBall'; groups: [BallGroup | null, BallGroup | null] }
  | { kind: 'carom'; lastInning: boolean };

export type FoulCode =
  | 'scratch'
  | 'noContact'
  | 'wrongBallFirst'
  | 'noRail'
  | 'illegalBreak'
  | 'hitOpponentBall'
  | 'breakNotRed'
  | 'timeViolation';

export type VerdictTag =
  | 'score'
  | 'bankShot'
  | 'miss'
  | 'foul'
  | 'groupAssigned'
  | 'eightRespotted'
  | 'eightEarly'
  | 'equalizingInning'
  | 'rackWon'
  | 'setWon'
  | 'gameWon'
  | 'draw';

/** Output of a RuleSet for one shot (or a time violation). */
export interface Verdict {
  shooter: Seat;
  points: number;
  penalty: number;
  foul: FoulCode | null;
  keepTurn: boolean;
  /** Ball in hand for the next shooter. */
  ballInHand: PlacementRegion | null;
  tags: VerdictTag[];
  /** Carom: cue-ball cushions before reaching the second object ball (or in total on a miss). */
  cushions?: number;
  /** Ends the current rack / set. */
  setWinner?: Seat;
  /** Ends the match directly. */
  gameWinner?: Seat | 'draw';
  /** Updated rule-specific state. */
  rule?: RuleState;
  /** Balls to put back on the table (e.g. the 8 after a break). */
  respot?: BallPosition[];
}

export type AnyRuleConfig = RuleConfigs[RuleSetId];

export interface SetRecord {
  winner: Seat;
  scores: [number, number];
}

export interface MatchState {
  ruleSet: RuleSetId;
  table: TableId;
  config: AnyRuleConfig;
  phase: GamePhase;
  players: [PlayerState, PlayerState];
  current: Seat;
  /** Seat that broke the current rack / set (and the opening break of the game). */
  breaker: Seat;
  /** 1-based rack / set number. */
  set: number;
  balls: BallPosition[];
  ballInHand: PlacementRegion | null;
  /** True until the first shot of a rack / set has been played. */
  breakShot: boolean;
  rule: RuleState;
  /** Shots played in the match. */
  shots: number;
  winner: Seat | 'draw' | null;
  lastVerdict: Verdict | null;
  sets: SetRecord[];
  /** Seed for racks; rack n uses seed + n so every rack is reproducible. */
  seed: number;
  /** Set when the match ended by forfeit (leave / disconnect claim): the seat that lost. */
  forfeitBy?: Seat;
}
