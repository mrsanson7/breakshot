import { DISCIPLINES, RULESET_NAMES, TABLES, type RoomSettings, type RoomView, type Seat } from '@breakshot/shared';
import { clear, h } from './dom';

export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}?room=${code}`;
}

export const BREAK_LABELS: Record<RoomSettings['breakDecision'], string> = {
  random: '랜덤',
  lag: '뱅킹 (레그 샷)',
  host: '방장 먼저',
  guest: '참가자 먼저',
};

export function settingsSummary(s: RoomSettings): string {
  const c = s.config as unknown as Record<string, unknown>;
  const parts = [DISCIPLINES[s.discipline].name, RULESET_NAMES[s.ruleSet], TABLES[s.table].name];
  if (s.ruleSet === 'wpa8') parts.push(`${c.raceTo}래크 선승`);
  if (s.ruleSet === 'umb3c') parts.push(`${c.targetPoints}점`);
  if (s.ruleSet === 'pba3c') {
    parts.push(`세트 ${c.setPoints}점 (마지막 ${c.finalSetPoints}점), ${c.setsToWin}세트 선승`);
    const o = c.opening as { mode: string; spots: number[] };
    parts.push(o.mode === 'draw' ? '초구 배치 추첨' : `초구 배치 ${o.spots.join('-')}`);
  }
  if (s.ruleSet === 'korean4') parts.push(`목표 ${(c.targets as number[]).join(' / ')}점`);
  parts.push(Number(c.shotClock) > 0 ? `샷클락 ${c.shotClock}초` : '샷클락 없음');
  parts.push(`보조선 ${{ full: '길게', short: '짧게', off: '끄기' }[s.aimAssist]}`);
  parts.push(`선공 ${BREAK_LABELS[s.breakDecision]}`);
  return parts.join(' · ');
}

/** 대기실: room code, invite link, both seats, ready toggle. */
export class LobbyScreen {
  readonly el: HTMLDivElement;
  private seatsEl = h('div.seats');
  private readyBtn: HTMLButtonElement;
  private statusEl = h('p.muted');
  private ready = false;

  constructor(
    room: RoomView,
    private readonly mySeat: Seat,
    private readonly actions: { ready(r: boolean): void; leave(): void },
  ) {
    const link = inviteLink(room.code);
    const copy = (text: string, btn: HTMLButtonElement) => {
      void navigator.clipboard?.writeText(text).then(() => {
        const t = btn.textContent;
        btn.textContent = '복사됨';
        window.setTimeout(() => (btn.textContent = t), 1200);
      });
    };
    const copyCode = h('button.btn', {}, '코드 복사');
    copyCode.onclick = () => copy(room.code, copyCode);
    const copyLink = h('button.btn', {}, '초대 링크 복사');
    copyLink.onclick = () => copy(link, copyLink);
    this.readyBtn = h('button.btn.primary.big', { onclick: () => this.actions.ready(!this.ready) }, '준비 완료');
    this.el = h(
      'div.screen.lobby',
      {},
      h('div.screen-head', {}, h('button.btn.ghost', { onclick: () => this.actions.leave() }, '← 나가기'), h('h2', {}, '대기실')),
      h(
        'div.lobby-card',
        {},
        h('div.muted', {}, '방 코드'),
        h('div.code', {}, room.code),
        h('div.row.center-row', {}, copyCode, copyLink),
        h('input.link', { readOnly: true, value: link, onclick: (e: Event) => (e.target as HTMLInputElement).select() }),
        h('p.summary', {}, settingsSummary(room.settings)),
        this.seatsEl,
        this.readyBtn,
        this.statusEl,
      ),
    );
    this.update(room);
  }

  update(room: RoomView): void {
    clear(this.seatsEl);
    for (const seat of [0, 1] as Seat[]) {
      const p = room.seats[seat];
      this.seatsEl.append(
        h(
          'div.seat',
          { className: `seat ${p?.ready ? 'ready' : ''}` },
          h('span.dot', { className: `dot ${p ? (p.connected ? 'on' : 'off') : ''}` }),
          h('strong', {}, p ? p.nickname + (seat === this.mySeat ? ' (나)' : '') : '빈 자리'),
          h('span.muted', {}, seat === 0 ? '방장' : '참가자'),
          h('span.state', {}, p ? (p.ready ? '준비 완료' : p.connected ? '대기 중' : '연결 끊김') : '초대 링크를 보내세요'),
        ),
      );
    }
    this.ready = !!room.seats[this.mySeat]?.ready;
    this.readyBtn.textContent = this.ready ? '준비 취소' : '준비 완료';
    this.readyBtn.classList.toggle('primary', !this.ready);
    const other = room.seats[this.mySeat === 0 ? 1 : 0];
    this.statusEl.textContent = !other ? '상대를 기다리는 중…' : this.ready && !other.ready ? '상대가 준비하면 시작합니다.' : !this.ready ? '준비 완료를 누르세요.' : '곧 시작합니다…';
  }
}

/** 방 참가: code + nickname. */
export function joinForm(initialCode: string, initialName: string, onJoin: (code: string, nickname: string) => void, onBack: () => void, error = ''): HTMLElement {
  const code = h('input.code-input', { type: 'text', maxLength: 6, placeholder: 'ABC123', value: initialCode, autocapitalize: 'characters', spellcheck: false });
  const name = h('input', { type: 'text', maxLength: 16, placeholder: '닉네임', value: initialName });
  const err = h('div.error', {}, error);
  const submit = () => {
    const c = code.value.trim().toUpperCase();
    const n = name.value.trim();
    if (c.length !== 6) return void (err.textContent = '6자리 방 코드를 입력하세요.');
    if (!n) return void (err.textContent = '닉네임을 입력하세요.');
    onJoin(c, n);
  };
  code.addEventListener('input', () => (code.value = code.value.toUpperCase()));
  for (const i of [code, name]) i.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  return h(
    'div.screen.join',
    {},
    h('div.screen-head', {}, h('button.btn.ghost', { onclick: onBack }, '← 뒤로'), h('h2', {}, '방 참가')),
    h(
      'div.lobby-card',
      {},
      h('label.field', {}, h('span', {}, '방 코드'), code),
      h('label.field', {}, h('span', {}, '닉네임'), name),
      h('button.btn.primary.big', { onclick: submit }, '참가'),
      err,
    ),
  );
}
