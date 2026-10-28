import { z } from 'zod';
import { RULE_DEFAULTS, RULE_LIMITS, type RuleConfigs, type RuleSetId } from '../config/rules';
import { DISCIPLINES, type DisciplineId } from '../config/disciplines';
import type { TableId } from '../config/tables';
import type { AimAssistLevel } from '../config/aim';

/** How the first breaker is chosen. */
export type BreakDecision = 'lag' | 'random';

/** Everything chosen on the "방 만들기" (or practice setup) screen. */
export interface RoomSettings<R extends RuleSetId = RuleSetId> {
  discipline: DisciplineId;
  ruleSet: R;
  table: TableId;
  config: RuleConfigs[R];
  aimAssist: AimAssistLevel;
  breakDecision: BreakDecision;
  /** Felt colour override (CSS colour) or null for the table default. */
  felt: string | null;
}

const int = (l: { min: number; max: number }) => z.number().int().min(l.min).max(l.max);
const clock = {
  shotClock: int(RULE_LIMITS.shotClock),
  timeouts: int(RULE_LIMITS.timeouts),
  extensionSeconds: int(RULE_LIMITS.extensionSeconds),
};

export const ruleConfigSchemas = {
  wpa8: z.object({
    ...clock,
    raceTo: int(RULE_LIMITS.raceTo),
    breakRotation: z.enum(['alternate', 'winner']),
    legalBreakMinRailBalls: z.number().int().min(0).max(15),
  }),
  umb3c: z.object({
    ...clock,
    targetPoints: int(RULE_LIMITS.targetPoints),
    equalizingInning: z.boolean(),
    breakMustHitRedFirst: z.boolean(),
  }),
  pba3c: z.object({
    ...clock,
    setPoints: int(RULE_LIMITS.setPoints),
    finalSetPoints: int(RULE_LIMITS.setPoints),
    setsToWin: int(RULE_LIMITS.setsToWin),
    bankShot: z.object({
      enabled: z.boolean(),
      minCushionsBeforeFirstBall: z.number().int().min(1).max(10),
      points: z.number().int().min(1).max(5),
    }),
    setBreak: z.enum(['alternate', 'loser']),
    breakMustHitRedFirst: z.boolean(),
  }),
  korean4: z.object({
    ...clock,
    targets: z.tuple([int(RULE_LIMITS.fourBallTarget), int(RULE_LIMITS.fourBallTarget)]),
    foulPenalty: int(RULE_LIMITS.foulPenalty),
  }),
} satisfies Record<RuleSetId, z.ZodTypeAny>;

const common = {
  aimAssist: z.enum(['full', 'short', 'off']),
  breakDecision: z.enum(['lag', 'random']),
  felt: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
};

export const roomSettingsSchema = z
  .discriminatedUnion('ruleSet', [
    z.object({ ruleSet: z.literal('wpa8'), discipline: z.literal('eightBall'), table: z.enum(['pool9ft']), config: ruleConfigSchemas.wpa8, ...common }),
    z.object({ ruleSet: z.literal('umb3c'), discipline: z.literal('threeCushion'), table: z.enum(['caromLarge']), config: ruleConfigSchemas.umb3c, ...common }),
    z.object({ ruleSet: z.literal('pba3c'), discipline: z.literal('threeCushion'), table: z.enum(['caromLarge']), config: ruleConfigSchemas.pba3c, ...common }),
    z.object({ ruleSet: z.literal('korean4'), discipline: z.literal('fourBall'), table: z.enum(['caromLarge', 'caromMedium']), config: ruleConfigSchemas.korean4, ...common }),
  ])
  .superRefine((s, ctx) => {
    const d = DISCIPLINES[s.discipline];
    if (!d.ruleSets.includes(s.ruleSet)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'rule set not in discipline' });
    if (!d.tables.includes(s.table)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'table not in discipline' });
  });

export function defaultSettings(discipline: DisciplineId, ruleSet?: RuleSetId): RoomSettings {
  const d = DISCIPLINES[discipline];
  const r = ruleSet && d.ruleSets.includes(ruleSet) ? ruleSet : d.defaultRuleSet;
  return {
    discipline,
    ruleSet: r,
    table: d.defaultTable,
    config: structuredClone(RULE_DEFAULTS[r]),
    aimAssist: 'full',
    breakDecision: 'random',
    felt: null,
  };
}
