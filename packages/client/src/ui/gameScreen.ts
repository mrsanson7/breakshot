import {
  CAROM_COLORS,
  cueBallFor,
  DISCIPLINES,
  FOUL_LABELS,
  groupOf,
  RULESET_NAMES,
  RULESETS,
  type MatchState,
  type Seat,
  type ShotEvent,
  type Verdict,
} from '@breakshot/shared';
import { GameScene } from '../game/scene';
import type { ClockView, ConnectionStatus, Session, SessionEvent, ShotPlayback } from '../session/types';
import { sound } from '../audio/sound';
import { helpButton } from './help';
import { soundButtons } from './soundButtons';
import { h } from './dom';

export interface GameScreenHooks {
  onExit(): void;
  /** Show the result screen (GameOver). */
  onGameOver(state: MatchState, history: ShotPlayback[]): void;
}

const GROUP_NAMES = { solids: '솔리드 (1–7)', stripes: '스트라이프 (9–15)' } as const;

/**
 * In-game screen: HUD + table scene + action bar. Consumes SessionEvents; works the same for
 * practice (local engine) and online (server-authoritative) sessions.
 */
export class GameScreen {
  readonly el: HTMLDivElement;
  readonly scene: GameScene;
  private state: MatchState;
  private queue: SessionEvent[] = [];
  private busy = false;
  private unsub: () => void;
  private clock: ClockView = { deadline: null, total: 0, paused: false };
  private clockTimer: number;
  private conn: { status: ConnectionStatus; opponentConnected: boolean; opponentDeadline: number | null } = {
    status: 'local',
    opponentConnected: true,
    opponentDeadline: null,
  };
  /** Every shot of the match, for replays. */
  readonly history: ShotPlayback[] = [];

  private hud = {
    cards: [] as HTMLDivElement[],
    names: [] as HTMLSpanElement[],
    stats: [] as HTMLSpanElement[],
    scores: [] as HTMLDivElement[],
    swatches: [] as HTMLSpanElement[],
    mode: h('div.mode'),
    info: h('div.turn'),
    clock: h('div.clock'),
    clockFill: h('div.clock-fill'),
    conn: h('div.conn'),
  };
  private toastEl = h('div.toast');
  private bannerEl = h('div.banner');
  private disconnectEl = h('div.disconnect');
  private bar = h('div.game-bar');
  private undoBtn?: HTMLButtonElement;
  private timeoutBtn: HTMLButtonElement;
  private replayBtn: HTMLButtonElement;
  private toastTimer = 0;

  constructor(
    private readonly session: Session,
    private readonly hooks: GameScreenHooks,
  ) {
    const s = session.settings;
    this.state = session.state;
    this.scene = new GameScene(s.table, s.discipline, {
      onShoot: (req) => {
        sound.cue(req.input.power);
        this.session.shoot(req);
      },
      onAim: (aim) => this.session.sendAim(aim),
    });
    this.scene.setFelt(s.felt);

    for (const seat of [0, 1] as Seat[]) {
      const swatch = h('span.swatch');
      const name = h('span.name');
      const stats = h('span.stats');
      const score = h('div.big');
      const card = h('div.pcard', {}, swatch, name, stats, score);
      this.hud.cards.push(card);
      this.hud.names.push(name);
      this.hud.stats.push(stats);
      this.hud.scores.push(score);
      this.hud.swatches.push(swatch);
    }
    const centre = h('div.center', {}, this.hud.mode, this.hud.info, h('div.clock-wrap', {}, this.hud.clock, h('div.clock-bar', {}, this.hud.clockFill)), this.hud.conn);
    const hudEl = h('div.hud', {}, this.hud.cards[0], centre, this.hud.cards[1]);

    this.timeoutBtn = h('button.btn', { onclick: () => this.session.useTimeout(), title: '샷클락 연장' }, '연장');
    const skipBtn = h('button.btn', { onclick: () => this.scene.skipAnimation(), title: '공이 멈출 때까지 건너뛰기' }, '건너뛰기');
    this.replayBtn = h('button.btn', { onclick: () => void this.replayLast(), title: '직전 샷 다시 보기' }, '다시 보기');
    const exitBtn = h('button.btn.ghost', { onclick: () => this.exit() }, '나가기');
    this.bar.append(this.timeoutBtn, skipBtn, this.replayBtn, ...soundButtons());
    if (session.undo) {
      this.undoBtn = h('button.btn', { onclick: () => session.undo!(), title: '직전 샷 되돌리기' }, '되돌리기');
      this.bar.append(this.undoBtn, h('button.btn', { onclick: () => session.restart!() }, '처음부터'));
    }
    this.bar.append(h('span.spacer'), helpButton('❓ 조작법'), exitBtn);

    const stage = this.scene.el.querySelector('.stage')!;
    stage.append(this.toastEl, this.bannerEl, this.disconnectEl);
    this.el = h('div.game', {}, hudEl, this.scene.el, this.bar);

    this.hud.mode.textContent = `${DISCIPLINES[s.discipline].name} · ${RULESET_NAMES[s.ruleSet]}`;
    this.unsub = session.subscribe((e) => this.onEvent(e));
    this.clockTimer = window.setInterval(() => this.renderClock(), 100);
  }

  start(): void {
    this.scene.start();
  }

  dispose(): void {
    this.unsub();
    window.clearInterval(this.clockTimer);
    this.scene.dispose();
  }

  private exit(): void {
    this.session.leave();
    this.hooks.onExit();
  }

  // -------------------------------------------------------------------------------------------
  // Events

  private onEvent(e: SessionEvent): void {
    // Events that must not wait behind an animation.
    if (e.type === 'aim') {
      if (!this.busy && !this.session.mySeats.includes(this.state.current)) this.scene.showRemoteAim(e.aim);
      return;
    }
    if (e.type === 'clock') {
      this.clock = e.clock;
      this.renderClock();
      return;
    }
    if (e.type === 'connection') {
      this.conn = e;
      this.renderConnection();
      return;
    }
    if (e.type === 'notice') {
      this.toast(e.text);
      return;
    }
    this.queue.push(e);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length > 0) {
      const e = this.queue.shift()!;
      if (e.type === 'state') this.applyState(e.state);
      else if (e.type === 'shot') await this.playShot(e.shot);
      else if (e.type === 'verdict') {
        this.announce(e.verdict, e.state);
        this.applyState(e.state);
      }
    }
    this.busy = false;
    this.applyTurn();
  }

  /** Replay the previous shot, then restore the live table. */
  private async replayLast(): Promise<void> {
    const shot = this.history[this.history.length - 1];
    if (!shot || this.busy) return;
    this.busy = true;
    this.scene.setTurn(null);
    this.banner('다시 보기', 900);
    await this.scene.playShot(shot.start, shot.cueBall, shot.input, shot.final, { onEvent: (e) => sound.event(e) });
    this.scene.setBalls(this.state.balls);
    this.busy = false;
    void this.drain();
  }

  private async playShot(shot: ShotPlayback): Promise<void> {
    this.history.push(shot);
    this.scene.setTurn(null);
    this.scene.setBalls(shot.start);
    const carom = DISCIPLINES[this.session.settings.discipline].id === 'threeCushion';
    // 3-cushion: number the cue ball's cushion contacts until it reaches the second object ball.
    let cushions = 0;
    const touched = new Set<string>();
    await this.scene.playShot(shot.start, shot.cueBall, shot.input, shot.final, {
      onEvent: (ev: ShotEvent, sim) => {
        sound.event(ev);
        if (ev.type === 'ballBall' && ev.speed > 1.5) {
          const a = sim.ball(ev.a);
          const b = sim.ball(ev.b);
          this.scene.ring({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 'rgba(255,255,255,0.55)', 0.3);
        }
        if (!carom) return;
        if (ev.type === 'ballBall' && (ev.a === shot.cueBall || ev.b === shot.cueBall)) touched.add(ev.a === shot.cueBall ? ev.b : ev.a);
        if (ev.type === 'cushion' && ev.ball === shot.cueBall && touched.size < 2) {
          cushions++;
          const b = sim.ball(shot.cueBall);
          this.scene.floatText({ x: b.x, y: b.y }, String(cushions), cushions >= 3 ? '#46d17d' : '#ffffff', 1.1, 30);
        }
      },
    });
    this.announce(shot.verdict, shot.state);
    this.applyState(shot.state);
    this.session.animationDone();
  }

  private applyState(state: MatchState): void {
    const prevSet = this.state.set;
    this.state = state;
    this.scene.setBalls(state.balls);
    this.renderHud();
    if (state.set !== prevSet && state.phase !== 'GameOver') {
      this.banner(`${state.ruleSet === 'wpa8' ? '래크' : '세트'} ${state.set} 시작`, 1600);
    }
    if (state.phase === 'SetOver') {
      const w = state.sets[state.sets.length - 1]?.winner;
      if (w !== undefined) this.banner(`${state.players[w].name} ${state.ruleSet === 'wpa8' ? '래크' : '세트'} 승리!`, 3000);
    }
    if (state.phase === 'GameOver') {
      sound.win();
      window.setTimeout(() => this.hooks.onGameOver(this.state, this.history), 1200);
    }
    if (!this.busy) this.applyTurn();
  }

  private applyTurn(): void {
    const s = this.state;
    const live = s.phase === 'Aiming' || s.phase === 'BallInHand';
    const mine = this.session.mySeats.includes(s.current);
    this.scene.setTurn(
      live
        ? {
            interactive: mine && this.conn.status !== 'reconnecting' && this.conn.status !== 'offline',
            cueBall: cueBallFor(s),
            ballInHand: s.ballInHand,
            assist: this.session.settings.aimAssist,
          }
        : null,
    );
    this.timeoutBtn.disabled = !(live && mine && s.config.shotClock > 0 && s.players[s.current].timeoutsLeft > 0);
    this.replayBtn.disabled = this.history.length === 0;
    if (this.undoBtn) this.undoBtn.disabled = !this.session.canUndo?.();
    this.renderHud();
  }

  // -------------------------------------------------------------------------------------------
  // HUD

  private renderHud(): void {
    const s = this.state;
    const rules = RULESETS[s.ruleSet];
    const pool = s.ruleSet === 'wpa8';
    const setBased = rules.setsToWin(s.config) > 1;
    for (const seat of [0, 1] as Seat[]) {
      const p = s.players[seat];
      const active = (s.phase === 'Aiming' || s.phase === 'BallInHand') && s.current === seat;
      this.hud.cards[seat].classList.toggle('active', active);
      this.hud.names[seat].textContent = p.name + (this.session.kind === 'online' && this.session.mySeats.includes(seat) ? ' (나)' : '');
      const swatch = this.hud.swatches[seat];
      if (pool) {
        const g = s.rule.kind === 'eightBall' ? s.rule.groups[seat] : null;
        swatch.style.background = g === 'solids' ? '#f2c21b' : g === 'stripes' ? 'repeating-linear-gradient(0deg,#f6f3ea 0 30%,#1f4fbf 30% 70%,#f6f3ea 70%)' : '#3a4650';
      } else {
        swatch.style.background = seat === 0 ? CAROM_COLORS.white : CAROM_COLORS.yellow;
      }
      const stats: string[] = [];
      if (pool) {
        const g = s.rule.kind === 'eightBall' ? s.rule.groups[seat] : null;
        if (g) {
          const left = s.balls.filter((b) => !b.pocketed && groupOf(b.id) === g).length;
          stats.push(`${GROUP_NAMES[g]} · ${left}개 남음`);
        } else stats.push('그룹 미정 (오픈 테이블)');
      } else {
        stats.push(`이닝 ${p.innings}`, `하이런 ${p.highRun}`);
        if (p.innings > 0 && s.ruleSet === 'umb3c') stats.push(`에버 ${(p.score / p.innings).toFixed(3)}`);
      }
      if (s.config.shotClock > 0) stats.push(`연장 ${p.timeoutsLeft}`);
      this.hud.stats[seat].textContent = stats.join(' · ');
      const target = rules.target(s, seat);
      const big = this.hud.scores[seat];
      if (pool) big.innerHTML = `${p.sets}<small>/${rules.setsToWin(s.config)}</small>`;
      else big.innerHTML = `${p.score}<small>/${target ?? ''}</small>`;
      if (setBased && !pool) big.innerHTML += `<em>세트 ${p.sets}</em>`;
    }
    const info: string[] = [];
    if (s.ruleSet === 'wpa8') info.push(`래크 ${s.set}`);
    else {
      info.push(`이닝 ${s.players[s.breaker].innings}`);
      if (setBased) info.push(`세트 ${s.set} (${s.players[0].sets}:${s.players[1].sets})`);
    }
    if (s.phase === 'BallInHand') info.push(s.ballInHand === 'kitchen' ? '프리볼 (헤드 스트링 뒤)' : '프리볼');
    if (s.rule.kind === 'carom' && s.rule.lastInning) info.push('마지막 이닝');
    const turnName = s.players[s.current].name;
    if (s.phase === 'Aiming' || s.phase === 'BallInHand') {
      const mine = this.session.mySeats.includes(s.current);
      info.push(this.session.kind === 'online' ? (mine ? '내 차례' : `${turnName} 조준 중`) : `${turnName} 차례`);
    }
    this.hud.info.textContent = info.join(' · ');
  }

  private renderClock(): void {
    const c = this.clock;
    if (!c.deadline || this.state.config.shotClock <= 0) {
      this.hud.clock.textContent = this.state.config.shotClock > 0 ? '' : '샷클락 없음';
      this.hud.clockFill.style.width = '0%';
      return;
    }
    const left = Math.max(0, (c.paused && c.pausedRemaining !== undefined ? c.pausedRemaining : c.deadline - Date.now()) / 1000);
    this.hud.clock.textContent = c.paused ? `⏸ ${Math.ceil(left)}초` : `${Math.ceil(left)}초`;
    this.hud.clock.classList.toggle('low', left <= 10);
    this.hud.clockFill.style.width = `${Math.min(100, (left / Math.max(1, c.total)) * 100)}%`;
    if (left > 0 && left <= 5 && Math.abs(left - Math.round(left)) < 0.05) sound.tick();
  }

  private renderConnection(): void {
    const c = this.conn;
    const el = this.hud.conn;
    if (c.status === 'local') {
      el.textContent = '연습 모드';
      el.className = 'conn';
    } else {
      const label = c.status === 'connected' ? (c.opponentConnected ? '연결됨' : '상대 연결 끊김') : c.status === 'reconnecting' ? '재접속 중…' : '오프라인';
      el.textContent = `● ${label}`;
      el.className = `conn ${c.status === 'connected' && c.opponentConnected ? 'ok' : 'warn'}`;
    }
    // Opponent disconnected prompt.
    this.disconnectEl.innerHTML = '';
    if (c.status === 'connected' && !c.opponentConnected && c.opponentDeadline) {
      const left = h('strong');
      const tick = () => {
        const sec = Math.max(0, Math.ceil((c.opponentDeadline! - Date.now()) / 1000));
        left.textContent = `${sec}초`;
        expired.hidden = sec > 0;
      };
      const expired = h(
        'div.row',
        {},
        h('button.btn.primary', { onclick: () => this.session.claimForfeit?.() }, '몰수승 처리'),
        h('button.btn', { onclick: () => this.session.keepWaiting?.() }, '더 기다리기'),
      );
      this.disconnectEl.append(h('div.panel', {}, h('div', {}, '상대 연결이 끊겼습니다. 재접속 대기 ', left), expired));
      tick();
      const id = window.setInterval(() => (this.disconnectEl.isConnected && this.conn === c ? tick() : window.clearInterval(id)), 250);
    }
    this.applyTurn();
  }

  // -------------------------------------------------------------------------------------------
  // Messages

  private announce(v: Verdict, after: MatchState): void {
    const name = after.players[v.shooter].name;
    const msgs: string[] = [];
    if (v.foul) msgs.push(FOUL_LABELS[v.foul]);
    if (v.tags.includes('bankShot')) msgs.push('뱅크샷 2점!');
    else if (v.points > 0 && after.ruleSet !== 'wpa8') msgs.push(`${name} 득점 +${v.points}`);
    if (v.penalty > 0) msgs.push(`감점 −${v.penalty}`);
    if (v.tags.includes('groupAssigned') && after.rule.kind === 'eightBall') {
      const g = after.rule.groups[v.shooter];
      if (g) msgs.push(`${name}: ${GROUP_NAMES[g]}`);
    }
    if (v.tags.includes('eightRespotted')) msgs.push('8번 공 재배치');
    if (v.tags.includes('eightEarly')) msgs.push('8번 공 조기 포켓인 — 래크 패배');
    if (v.tags.includes('equalizingInning')) msgs.push('목표 도달! 상대 마지막 이닝');
    if (v.tags.includes('draw')) msgs.push('무승부');
    if (v.points > 0) sound.score(v.tags.includes('bankShot'));
    if (v.foul) sound.foul();
    if (msgs.length > 0) this.toast(msgs.join(' · '), v.foul ? 'bad' : v.points > 0 || v.tags.includes('score') ? 'good' : '');
    if (v.cushions !== undefined && after.ruleSet !== 'korean4' && v.points > 0) {
      this.banner(`${v.cushions}쿠션${v.tags.includes('bankShot') ? ' · 뱅크샷' : ''}`, 1300);
    }
  }

  toast(text: string, kind = ''): void {
    this.toastEl.textContent = text;
    this.toastEl.className = `toast show ${kind}`;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.className = 'toast'), 2600);
  }

  private banner(text: string, ms: number): void {
    this.bannerEl.textContent = text;
    this.bannerEl.className = 'banner show';
    window.setTimeout(() => (this.bannerEl.className = 'banner'), ms);
  }
}
