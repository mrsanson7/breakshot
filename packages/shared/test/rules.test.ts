import { describe, expect, it } from 'vitest';
import {
  applyShot,
  applyTimeViolation,
  createMatch,
  judgeShotLog,
  RULESETS,
  startMatch,
  startNextSet,
  validateShot,
  type BallPosition,
  type MatchState,
  type RailId,
  type RuleSetId,
  type ShotEvent,
  type ShotLog,
  type TableId,
} from '../src';

// ---- Synthetic shot logs ------------------------------------------------------------------------
// Rules only read events + pocketed + final, so tests describe shots as compact event lists:
//   'c:top'      cue-ball cushion          'b:red'     cue ball hits red
//   'o:3:left'   ball 3 cushion            'x:3:5'     ball 3 hits ball 5
//   'p:3'        ball 3 pocketed
function log(state: MatchState, cueBall: string, spec: string[]): ShotLog {
  const events: ShotEvent[] = [];
  const pocketed: string[] = [];
  spec.forEach((s, i) => {
    const [k, a, b] = s.split(':');
    const t = i * 0.1;
    if (k === 'c') events.push({ type: 'cushion', t, ball: cueBall, rail: a as RailId, speed: 1 });
    else if (k === 'b') events.push({ type: 'ballBall', t, a: cueBall, b: a, speed: 1 });
    else if (k === 'o') events.push({ type: 'cushion', t, ball: a, rail: b as RailId, speed: 1 });
    else if (k === 'x') events.push({ type: 'ballBall', t, a, b, speed: 1 });
    else if (k === 'p') {
      events.push({ type: 'pocket', t, ball: a, pocket: 'BL' });
      pocketed.push(a);
    }
  });
  const final: BallPosition[] = state.balls.map((b) => (pocketed.includes(b.id) ? { ...b, pocketed: true } : { ...b }));
  return { cueBall, events, pocketed, final, duration: spec.length * 0.1 };
}

/** Judge a synthetic shot through the engine (no physics). */
function play(state: MatchState, spec: string[]): MatchState {
  const cue = RULESETS[state.ruleSet].cueBallOf(state, state.current);
  return judgeShotLog(state, log(state, cue, spec)).state;
}

function newMatch(ruleSet: RuleSetId, table: TableId, config: object = {}, firstBreaker: 0 | 1 = 0): MatchState {
  return startMatch(createMatch({ ruleSet, table, config, names: ['A', 'B'], seed: 1, firstBreaker }));
}

/** Put the table in a given 8-ball situation: pocket listed balls, assign groups, clear break. */
function eightBallAt(opts: { pocketed?: string[]; groups?: ['solids' | 'stripes' | null, 'solids' | 'stripes' | null]; current?: 0 | 1 } = {}): MatchState {
  const s = newMatch('wpa8', 'pool9ft');
  return {
    ...s,
    phase: 'Aiming',
    ballInHand: null,
    breakShot: false,
    current: opts.current ?? 0,
    balls: s.balls.map((b) => (opts.pocketed?.includes(b.id) ? { ...b, pocketed: true } : b)),
    rule: { kind: 'eightBall', groups: opts.groups ?? [null, null] },
  };
}

// ---- 8-ball --------------------------------------------------------------------------------------
describe('8-ball (WPA)', () => {
  it('starts with ball in hand behind the head string for the breaker', () => {
    const s = newMatch('wpa8', 'pool9ft');
    expect(s.phase).toBe('BallInHand');
    expect(s.ballInHand).toBe('kitchen');
    expect(s.balls).toHaveLength(16);
  });

  it('break that pockets a ball keeps the turn, table stays open', () => {
    const s = { ...newMatch('wpa8', 'pool9ft'), ballInHand: null, phase: 'Aiming' as const };
    const n = play(s, ['b:1', 'x:1:3', 'p:3', 'o:5:top']);
    expect(n.current).toBe(0);
    expect(n.lastVerdict!.foul).toBeNull();
    expect(n.rule).toEqual({ kind: 'eightBall', groups: [null, null] });
  });

  it('break with fewer than 4 balls to a cushion and nothing down is a foul', () => {
    const s = { ...newMatch('wpa8', 'pool9ft'), ballInHand: null, phase: 'Aiming' as const };
    const n = play(s, ['b:1', 'o:2:top', 'o:3:top', 'o:4:right']);
    expect(n.lastVerdict!.foul).toBe('illegalBreak');
    expect(n.current).toBe(1);
    expect(n.phase).toBe('BallInHand');
    expect(n.ballInHand).toBe('anywhere');
  });

  it('break with 4 balls to a cushion is legal (turn passes, no foul)', () => {
    const s = { ...newMatch('wpa8', 'pool9ft'), ballInHand: null, phase: 'Aiming' as const };
    const n = play(s, ['b:1', 'o:2:top', 'o:3:top', 'o:4:right', 'o:5:bottom']);
    expect(n.lastVerdict!.foul).toBeNull();
    expect(n.current).toBe(1);
    expect(n.phase).toBe('Aiming');
  });

  it('8 pocketed on the break is re-spotted and does not lose', () => {
    const s = { ...newMatch('wpa8', 'pool9ft'), ballInHand: null, phase: 'Aiming' as const };
    const n = play(s, ['b:1', 'x:1:8', 'p:8', 'o:2:top']);
    expect(n.phase).not.toBe('SetOver');
    expect(n.balls.find((b) => b.id === '8')!.pocketed).toBe(false);
    expect(n.lastVerdict!.tags).toContain('eightRespotted');
  });

  it('first legal pocket on an open table assigns groups', () => {
    const n = play(eightBallAt(), ['b:3', 'p:3']);
    expect(n.rule).toEqual({ kind: 'eightBall', groups: ['solids', 'stripes'] });
    expect(n.current).toBe(0);
  });

  it('hitting the 8 first on an open table is a foul', () => {
    const n = play(eightBallAt(), ['b:8', 'o:8:top']);
    expect(n.lastVerdict!.foul).toBe('wrongBallFirst');
    expect(n.current).toBe(1);
    expect(n.ballInHand).toBe('anywhere');
  });

  it("hitting the opponent's group first is a foul", () => {
    const n = play(eightBallAt({ groups: ['solids', 'stripes'] }), ['b:12', 'o:12:top']);
    expect(n.lastVerdict!.foul).toBe('wrongBallFirst');
  });

  it('no cushion after contact and nothing pocketed is a foul', () => {
    const n = play(eightBallAt({ groups: ['solids', 'stripes'] }), ['b:2']);
    expect(n.lastVerdict!.foul).toBe('noRail');
  });

  it('scratch is a foul with ball in hand anywhere', () => {
    const n = play(eightBallAt({ groups: ['solids', 'stripes'] }), ['b:2', 'p:cue']);
    expect(n.lastVerdict!.foul).toBe('scratch');
    expect(n.phase).toBe('BallInHand');
  });

  it('pocketing only an opponent ball passes the turn', () => {
    const n = play(eightBallAt({ groups: ['solids', 'stripes'] }), ['b:2', 'x:2:12', 'p:12']);
    expect(n.lastVerdict!.foul).toBeNull();
    expect(n.current).toBe(1);
  });

  it('8 pocketed while own group remains loses the rack', () => {
    const n = play(eightBallAt({ groups: ['solids', 'stripes'] }), ['b:2', 'x:2:8', 'p:8']);
    expect(n.lastVerdict!.setWinner).toBe(1);
    expect(n.players[1].sets).toBe(1);
    expect(n.phase).toBe('SetOver');
  });

  it('8 pocketed legally after clearing the group wins the rack', () => {
    const s = eightBallAt({ groups: ['solids', 'stripes'], pocketed: ['1', '2', '3', '4', '5', '6', '7'] });
    const n = play(s, ['b:8', 'p:8']);
    expect(n.lastVerdict!.setWinner).toBe(0);
  });

  it('8 and cue ball pocketed together loses the rack', () => {
    const s = eightBallAt({ groups: ['solids', 'stripes'], pocketed: ['1', '2', '3', '4', '5', '6', '7'] });
    const n = play(s, ['b:8', 'p:8', 'p:cue']);
    expect(n.lastVerdict!.setWinner).toBe(1);
  });

  it('race to N ends the match; next rack alternates the break', () => {
    let s = eightBallAt({ groups: ['solids', 'stripes'], pocketed: ['1', '2', '3', '4', '5', '6', '7'] });
    s = { ...s, config: { ...s.config, raceTo: 2 } };
    s = play(s, ['b:8', 'p:8']);
    expect(s.phase).toBe('SetOver');
    s = startNextSet(s);
    expect(s.breaker).toBe(1);
    expect(s.set).toBe(2);
    expect(s.phase).toBe('BallInHand');
    expect(s.balls.every((b) => !b.pocketed)).toBe(true);
    s = { ...s, phase: 'Aiming', ballInHand: null, breakShot: false, current: 0, rule: { kind: 'eightBall', groups: ['solids', 'stripes'] }, balls: s.balls.map((b) => (Number(b.id) < 8 ? { ...b, pocketed: true } : b)) };
    s = play(s, ['b:8', 'p:8']);
    expect(s.phase).toBe('GameOver');
    expect(s.winner).toBe(0);
  });

  it('shot clock expiry gives the opponent ball in hand', () => {
    const { state } = applyTimeViolation(eightBallAt({ groups: ['solids', 'stripes'] }));
    expect(state.current).toBe(1);
    expect(state.phase).toBe('BallInHand');
  });
});

// ---- 3-cushion UMB -------------------------------------------------------------------------------
describe('3-cushion (UMB)', () => {
  const after = (s: MatchState) => ({ ...s, breakShot: false });

  it('3 cushions before the second ball scores and keeps the turn', () => {
    const n = play(after(newMatch('umb3c', 'caromLarge')), ['b:red', 'c:top', 'c:right', 'c:bottom', 'b:yellow']);
    expect(n.players[0].score).toBe(1);
    expect(n.current).toBe(0);
    expect(n.lastVerdict!.cushions).toBe(3);
  });

  it('cushions may all come before the first ball', () => {
    const n = play(after(newMatch('umb3c', 'caromLarge')), ['c:top', 'c:right', 'c:bottom', 'b:red', 'b:yellow']);
    expect(n.players[0].score).toBe(1);
  });

  it('the same cushion hit twice counts twice', () => {
    const n = play(after(newMatch('umb3c', 'caromLarge')), ['b:red', 'c:top', 'c:top', 'c:left', 'b:yellow']);
    expect(n.players[0].score).toBe(1);
  });

  it('only 2 cushions before the second ball is a miss; turn and inning pass', () => {
    const n = play(after(newMatch('umb3c', 'caromLarge')), ['b:red', 'c:top', 'c:right', 'b:yellow', 'c:bottom']);
    expect(n.players[0].score).toBe(0);
    expect(n.current).toBe(1);
    expect(n.players[1].innings).toBe(1);
    expect(n.lastVerdict!.cushions).toBe(2);
  });

  it('object-ball cushions do not count', () => {
    const n = play(after(newMatch('umb3c', 'caromLarge')), ['b:red', 'o:red:top', 'o:red:left', 'c:top', 'c:left', 'b:yellow']);
    expect(n.players[0].score).toBe(0);
  });

  it('touching only one ball is a miss', () => {
    const n = play(after(newMatch('umb3c', 'caromLarge')), ['c:top', 'c:left', 'c:right', 'b:red']);
    expect(n.players[0].score).toBe(0);
  });

  it("opening shot must hit the red first", () => {
    const n = play(newMatch('umb3c', 'caromLarge'), ['b:yellow', 'c:top', 'c:right', 'c:bottom', 'b:red']);
    expect(n.lastVerdict!.foul).toBe('breakNotRed');
    expect(n.players[0].score).toBe(0);
    expect(n.current).toBe(1);
  });

  const score3 = ['b:red', 'c:top', 'c:right', 'c:bottom', 'b:yellow'];
  const miss = ['b:red'];

  it('breaker reaching the target gives the opponent an equalizing inning; a miss ends it', () => {
    let s = after(newMatch('umb3c', 'caromLarge', { targetPoints: 2 }));
    s = play(s, score3);
    s = play(s, score3);
    expect(s.phase).toBe('Aiming');
    expect(s.current).toBe(1);
    expect(s.lastVerdict!.tags).toContain('equalizingInning');
    s = play(s, score3);
    expect(s.current).toBe(1);
    s = play(s, miss);
    expect(s.phase).toBe('GameOver');
    expect(s.winner).toBe(0);
  });

  it('equalizing to the target is a draw', () => {
    let s = after(newMatch('umb3c', 'caromLarge', { targetPoints: 1 }));
    s = play(s, score3);
    s = play(s, score3);
    expect(s.winner).toBe('draw');
  });

  it('without equalizing inning the first to the target wins', () => {
    let s = after(newMatch('umb3c', 'caromLarge', { targetPoints: 1, equalizingInning: false }));
    s = play(s, score3);
    expect(s.winner).toBe(0);
  });

  it('the second player reaching the target wins outright', () => {
    let s = after(newMatch('umb3c', 'caromLarge', { targetPoints: 1 }));
    s = play(s, miss);
    s = play(s, score3);
    expect(s.winner).toBe(1);
  });

  it('seat 0 shoots white, seat 1 yellow', () => {
    const s = newMatch('umb3c', 'caromLarge');
    expect(RULESETS.umb3c.cueBallOf(s, 0)).toBe('white');
    expect(RULESETS.umb3c.cueBallOf(s, 1)).toBe('yellow');
  });
});

// ---- 3-cushion PBA -------------------------------------------------------------------------------
describe('3-cushion (PBA)', () => {
  const after = (s: MatchState) => ({ ...s, breakShot: false });
  const bank = ['c:top', 'b:red', 'c:right', 'c:bottom', 'b:yellow'];
  const normal = ['b:red', 'c:top', 'c:right', 'c:bottom', 'b:yellow'];

  it('bank shot (cushion before the first ball) scores 2', () => {
    const n = play(after(newMatch('pba3c', 'caromLarge')), bank);
    expect(n.players[0].score).toBe(2);
    expect(n.lastVerdict!.tags).toContain('bankShot');
  });

  it('a normal point scores 1', () => {
    const n = play(after(newMatch('pba3c', 'caromLarge')), normal);
    expect(n.players[0].score).toBe(1);
    expect(n.lastVerdict!.tags).not.toContain('bankShot');
  });

  it('bank-shot criterion is configurable', () => {
    const n = play(after(newMatch('pba3c', 'caromLarge', { bankShot: { enabled: true, minCushionsBeforeFirstBall: 2, points: 2 } })), bank);
    expect(n.players[0].score).toBe(1);
  });

  it('sets: reaching the set target wins the set, scores reset, final set uses its own target', () => {
    let s = after(newMatch('pba3c', 'caromLarge', { setPoints: 2, finalSetPoints: 1, setsToWin: 2 }));
    s = play(s, normal);
    s = play(s, normal);
    expect(s.phase).toBe('SetOver');
    expect(s.players[0].sets).toBe(1);
    s = startNextSet(s);
    expect(s.players[0].score).toBe(0);
    expect(s.breaker).toBe(1);
    expect(s.current).toBe(1);
    s = play(after(s), normal);
    s = play(s, normal);
    expect(s.players[1].sets).toBe(1);
    s = startNextSet(s);
    expect(RULESETS.pba3c.target(s, 0)).toBe(1); // deciding set
    s = play(after(s), bank);
    expect(s.phase).toBe('GameOver');
    expect(s.winner).toBe(0);
  });
});

// ---- 4-ball --------------------------------------------------------------------------------------
describe('4-ball (Korean standard)', () => {
  const after = (s: MatchState) => ({ ...s, breakShot: false });

  it('hitting both reds scores 1 and keeps the turn', () => {
    const n = play(after(newMatch('korean4', 'caromMedium')), ['b:red', 'b:red2']);
    expect(n.players[0].score).toBe(1);
    expect(n.current).toBe(0);
  });

  it('only one red is a miss', () => {
    const n = play(after(newMatch('korean4', 'caromMedium')), ['b:red', 'c:top', 'x:red:red2']);
    expect(n.players[0].score).toBe(0);
    expect(n.current).toBe(1);
  });

  it("touching the opponent's ball is a foul even with both reds", () => {
    const n = play(after(newMatch('korean4', 'caromMedium')), ['b:red', 'b:red2', 'b:yellow']);
    expect(n.lastVerdict!.foul).toBe('hitOpponentBall');
    expect(n.players[0].score).toBe(0);
    expect(n.current).toBe(1);
  });

  it('hitting nothing is a foul; penalty applies only when configured', () => {
    let s = after(newMatch('korean4', 'caromMedium', { foulPenalty: 1 }));
    s = { ...s, players: [{ ...s.players[0], score: 3 }, s.players[1]] };
    const n = play(s, ['c:top', 'c:left']);
    expect(n.lastVerdict!.foul).toBe('noContact');
    expect(n.players[0].score).toBe(2);
    const n2 = play(after(newMatch('korean4', 'caromMedium')), ['c:top']);
    expect(n2.players[0].score).toBe(0);
  });

  it('each player wins at their own target (handicap)', () => {
    let s = after(newMatch('korean4', 'caromMedium', { targets: [2, 1] }));
    s = play(s, ['b:red', 'b:red2']);
    s = play(s, ['b:red']);
    s = play(s, ['b:red', 'b:red2']);
    expect(s.winner).toBe(1);
  });
});

// ---- Engine: validation, physics integration, determinism ----------------------------------------
describe('match engine', () => {
  it('rejects a shot from the wrong seat or with out-of-range power', () => {
    const s = newMatch('umb3c', 'caromLarge');
    const ok = { input: { angle: 0, power: 0.5, spinX: 0, spinY: 0 } };
    expect(validateShot(s, 1, ok)).toBe('notYourTurn');
    expect(validateShot(s, 0, { input: { ...ok.input, power: 1.5 } })).toBe('badInput');
    expect(validateShot(s, 0, { input: { ...ok.input, power: 0 } })).toBe('badInput');
    expect(validateShot(s, 0, { input: { ...ok.input, spinX: 1, spinY: 1 } })).toBe('badInput');
    expect(validateShot(s, 0, { input: { ...ok.input, angle: NaN } })).toBe('badInput');
    expect(validateShot(s, 0, ok)).toBeNull();
  });

  it('ball in hand requires a valid placement', () => {
    const s = newMatch('wpa8', 'pool9ft');
    const input = { angle: 0, power: 0.9, spinX: 0, spinY: 0 };
    expect(validateShot(s, 0, { input })).toBe('placementRequired');
    expect(validateShot(s, 0, { input, cueBallPos: { x: 2.0, y: 0.6 } })).toBe('badPlacement'); // outside kitchen
    const apex = s.balls.find((b) => b.id !== 'cue')!;
    expect(validateShot(s, 0, { input, cueBallPos: { x: apex.x, y: apex.y } })).toBe('badPlacement');
    expect(validateShot(s, 0, { input, cueBallPos: { x: 0.5, y: 0.6 } })).toBeNull();
  });

  it('applyShot runs physics + rules and moves the state machine', () => {
    const s = newMatch('wpa8', 'pool9ft');
    const out = applyShot(s, 0, { input: { angle: 0, power: 1, spinX: 0, spinY: 0 }, cueBallPos: { x: 0.6, y: 0.635 } });
    expect(out.start.find((b) => b.id === 'cue')).toMatchObject({ x: 0.6, y: 0.635 });
    expect(out.log.events.length).toBeGreaterThan(10);
    expect(['Aiming', 'BallInHand']).toContain(out.state.phase);
    expect(out.state.breakShot).toBe(false);
    expect(out.state.shots).toBe(1);
  });

  it('same initial state + same inputs → same match state', () => {
    const run = () => {
      let s = newMatch('umb3c', 'caromLarge');
      const inputs = [0.1, 2.0, -1.2, 0.7, 3.0].map((a, i) => ({ angle: a, power: 0.3 + i * 0.1, spinX: 0.3, spinY: -0.2 }));
      for (const input of inputs) s = applyShot(s, s.current, { input }).state;
      return s;
    };
    expect(run()).toEqual(run());
  });

  it('a 3-cushion point made by real physics is scored', () => {
    // Search a simple shot space with the real engine until a point is found, then check it scores.
    let s = { ...newMatch('umb3c', 'caromLarge'), breakShot: false };
    let found = false;
    for (let i = 0; i < 720 && !found; i++) {
      const out = applyShot(s, 0, { input: { angle: (i / 720) * Math.PI * 2, power: 0.75, spinX: 0.4, spinY: 0.2 } });
      if (out.verdict.points > 0) {
        found = true;
        expect(out.verdict.cushions).toBeGreaterThanOrEqual(3);
        expect(out.state.players[0].score).toBe(1);
        expect(out.state.current).toBe(0);
      }
    }
    expect(found).toBe(true);
  });
});
