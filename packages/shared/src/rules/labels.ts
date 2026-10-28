import type { FoulCode } from '../game/state';

/** Korean UI strings for fouls (shared so server logs and both clients agree). */
export const FOUL_LABELS: Record<FoulCode, string> = {
  scratch: '파울: 큐볼 포켓인',
  noContact: '파울: 공을 맞히지 못함',
  wrongBallFirst: '파울: 첫 충돌이 자기 공이 아님',
  noRail: '파울: 충돌 후 쿠션에 닿은 공 없음',
  illegalBreak: '파울: 무효 브레이크',
  hitOpponentBall: '파울: 상대 수구를 맞힘',
  breakNotRed: '파울: 초구는 빨간공을 먼저',
  timeViolation: '시간 초과',
};
