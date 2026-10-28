import { DISCIPLINES, RULESET_NAMES, type MatchState } from '@breakshot/shared';
import type { Session, ShotPlayback } from '../session/types';
import { h } from './dom';

export interface ResultActions {
  again(): void;
  home(): void;
  replay(): void;
}

export function resultScreen(session: Session, state: MatchState, history: ShotPlayback[], actions: ResultActions): HTMLElement {
  const s = session.settings;
  const w = state.winner;
  const headline = w === 'draw' ? '무승부' : w === null ? '경기 종료' : `${state.players[w].name} ${state.forfeitBy !== undefined ? '몰수승' : '승리!'}`;
  const pool = state.ruleSet === 'wpa8';
  const rows = [0, 1].map((seat) => {
    const p = state.players[seat as 0 | 1];
    return h(
      'tr',
      { className: w === seat ? 'win' : '' },
      h('td', {}, p.name),
      h('td', {}, pool ? `${p.sets}` : `${p.score}`),
      pool ? null : h('td', {}, `${p.sets}`),
      pool ? null : h('td', {}, `${p.innings}`),
      pool ? null : h('td', {}, `${p.highRun}`),
      pool ? null : h('td', {}, p.innings ? (p.score / p.innings).toFixed(3) : '-'),
    );
  });
  return h(
    'div.screen.result',
    {},
    h('div.result-card', {},
      h('div.muted', {}, `${DISCIPLINES[s.discipline].name} · ${RULESET_NAMES[s.ruleSet]}`),
      h('h1', {}, headline),
      h('table.stats', {},
        h('thead', {}, h('tr', {}, h('th', {}, '선수'), h('th', {}, pool ? '래크' : '점수'), pool ? null : h('th', {}, '세트'), pool ? null : h('th', {}, '이닝'), pool ? null : h('th', {}, '하이런'), pool ? null : h('th', {}, '에버리지'))),
        h('tbody', {}, rows),
      ),
      state.sets.length > 1 ? h('div.sets', {}, state.sets.map((r, i) => h('span.set', {}, `${i + 1}세트 ${r.scores[0]}:${r.scores[1]}`))) : null,
      h('div.muted', {}, `총 ${history.length}샷`),
      h('div.menu.row', {},
        h('button.btn.primary', {
          onclick: (e: Event) => {
            actions.again();
            if (session.kind === 'online') {
              const b = e.currentTarget as HTMLButtonElement;
              b.textContent = '상대 응답 대기 중…';
              b.disabled = true;
            }
          },
        }, session.kind === 'practice' ? '다시 하기' : '재대결 요청'),
        history.length > 0 ? h('button.btn', { onclick: actions.replay }, '리플레이') : null,
        h('button.btn', { onclick: actions.home }, '타이틀로'),
      ),
    ),
  );
}
