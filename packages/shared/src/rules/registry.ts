import type { RuleSetId } from '../config/rules';
import { fourBallRules, threeCushionPbaRules, threeCushionUmbRules } from './carom';
import { eightBallRules } from './eightBall';
import type { RuleSet } from './types';

export const RULESETS: Record<RuleSetId, RuleSet> = {
  wpa8: eightBallRules as RuleSet,
  umb3c: threeCushionUmbRules as RuleSet,
  pba3c: threeCushionPbaRules as RuleSet,
  korean4: fourBallRules as RuleSet,
};
