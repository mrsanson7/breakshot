import type { DisciplineId } from '../config/disciplines';
import type { RuleSetId } from '../config/rules';
import type { TableSpec } from '../config/tables';
import type { PlacementRegion } from '../game/placement';
import type { AnyRuleConfig, MatchState, RuleState, Seat, Verdict } from '../game/state';
import type { BallPosition, ShotLog } from '../physics/types';

export interface RackSetup {
  balls: BallPosition[];
  ballInHand: PlacementRegion | null;
}

/**
 * A rule set judges shots. It never moves balls or touches the network: input is the shot log
 * plus the match state before the shot, output is a Verdict that the Match engine applies.
 *
 * Adding a rule set = one implementation of this interface + one entry in config/rules.ts
 * (+ its id in the discipline's `ruleSets` list).
 */
export interface RuleSet<C extends AnyRuleConfig = AnyRuleConfig> {
  id: RuleSetId;
  discipline: DisciplineId;
  /** Ball each seat shoots with. */
  cueBallOf(state: MatchState, seat: Seat): string;
  initialRuleState(): RuleState;
  /** Balls for the start of a rack / set, broken by `state.breaker`. */
  setupRack(state: MatchState, table: TableSpec, rng: () => number, rackGap: number): RackSetup;
  evaluate(state: MatchState, log: ShotLog): Verdict;
  /** The shot clock ran out before the player shot. */
  onTimeViolation(state: MatchState): Verdict;
  /** Racks / sets needed to win the match. */
  setsToWin(config: C): number;
  /** Points needed to finish the current game / set for a seat (HUD), null if not points-based. */
  target(state: MatchState, seat: Seat): number | null;
  /** Who breaks the next rack / set. */
  nextBreaker(state: MatchState, setWinner: Seat): Seat;
  /** Whether points reset at the start of each set. */
  resetScoreEachSet: boolean;
  /** When timeouts are refilled. */
  timeoutScope: 'game' | 'set';
}
