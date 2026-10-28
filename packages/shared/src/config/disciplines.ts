import type { PhysicsProfileId } from './physics';
import type { RuleSetId } from './rules';
import type { TableId } from './tables';

export type DisciplineId = 'eightBall' | 'threeCushion' | 'fourBall';

export interface BallDef {
  id: string;
  /** Number printed on the ball (pool), if any. */
  number?: number;
  color: string;
  stripe?: boolean;
}

export interface DisciplineSpec {
  id: DisciplineId;
  name: string;
  tables: TableId[];
  defaultTable: TableId;
  physics: PhysicsProfileId;
  ruleSets: RuleSetId[];
  defaultRuleSet: RuleSetId;
  balls: BallDef[];
}

const POOL_COLORS = [
  '#f2c21b', // 1 yellow
  '#1f4fbf', // 2 blue
  '#d62b2b', // 3 red
  '#5b2a86', // 4 purple
  '#f07a1a', // 5 orange
  '#1c7a3e', // 6 green
  '#7a2323', // 7 maroon
  '#111111', // 8 black
];

const poolBalls = (): BallDef[] => {
  const balls: BallDef[] = [{ id: 'cue', color: '#f6f3ea' }];
  for (let n = 1; n <= 15; n++) {
    balls.push({ id: String(n), number: n, color: POOL_COLORS[(n - 1) % 8], stripe: n > 8 });
  }
  return balls;
};

export const CAROM_COLORS = {
  white: '#f5f3ea',
  yellow: '#f2c22e',
  red: '#d42f2f',
} as const;

export const DISCIPLINES: Record<DisciplineId, DisciplineSpec> = {
  eightBall: {
    id: 'eightBall',
    name: '포켓볼 (8볼)',
    tables: ['pool9ft'],
    defaultTable: 'pool9ft',
    physics: 'pool',
    ruleSets: ['wpa8'],
    defaultRuleSet: 'wpa8',
    balls: poolBalls(),
  },
  threeCushion: {
    id: 'threeCushion',
    name: '3쿠션',
    tables: ['caromLarge'],
    defaultTable: 'caromLarge',
    physics: 'carom',
    ruleSets: ['umb3c', 'pba3c'],
    defaultRuleSet: 'umb3c',
    balls: [
      { id: 'white', color: CAROM_COLORS.white },
      { id: 'yellow', color: CAROM_COLORS.yellow },
      { id: 'red', color: CAROM_COLORS.red },
    ],
  },
  fourBall: {
    id: 'fourBall',
    name: '4구',
    tables: ['caromLarge', 'caromMedium'],
    defaultTable: 'caromMedium',
    physics: 'carom',
    ruleSets: ['korean4'],
    defaultRuleSet: 'korean4',
    balls: [
      { id: 'white', color: CAROM_COLORS.white },
      { id: 'yellow', color: CAROM_COLORS.yellow },
      { id: 'red', color: CAROM_COLORS.red },
      { id: 'red2', color: CAROM_COLORS.red },
    ],
  },
};

export const RULESET_NAMES: Record<RuleSetId, string> = {
  wpa8: 'WPA 국제 룰',
  umb3c: 'UMB 국제 룰',
  pba3c: 'PBA 룰',
  korean4: '한국 표준 룰',
};

export function disciplineOfRuleSet(id: RuleSetId): DisciplineSpec {
  for (const d of Object.values(DISCIPLINES)) if (d.ruleSets.includes(id)) return d;
  throw new Error(`no discipline for rule set ${id}`);
}
