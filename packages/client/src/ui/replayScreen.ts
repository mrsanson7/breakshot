import { FOUL_LABELS, type RoomSettings } from '@breakshot/shared';
import { GameScene } from '../game/scene';
import type { ShotPlayback } from '../session/types';
import { sound } from '../audio/sound';
import { h } from './dom';

const SPEEDS = [0.5, 1, 2, 4];

/** Replays recorded shots (start + input → same physics), one after another. */
export class ReplayScreen {
  readonly el: HTMLDivElement;
  private scene: GameScene;
  private index = 0;
  private playing = false;
  private speed = 1;
  private label = h('span.replay-label');
  private playBtn: HTMLButtonElement;
  private token = 0;

  constructor(
    settings: RoomSettings,
    private readonly shots: ShotPlayback[],
    onClose: () => void,
  ) {
    this.scene = new GameScene(settings.table, settings.discipline, { onShoot: () => {} });
    this.scene.setFelt(settings.felt);
    this.playBtn = h('button.btn.primary', { onclick: () => (this.playing ? this.pause() : this.play()) }, '▶ 재생');
    const speedSel = h(
      'select.speed',
      { onchange: (e: Event) => (this.speed = Number((e.target as HTMLSelectElement).value)) },
      SPEEDS.map((s) => h('option', { value: String(s), selected: s === 1 }, `${s}×`)),
    );
    this.el = h(
      'div.game.replay',
      {},
      h(
        'div.lag-head',
        {},
        h('strong', {}, '리플레이'),
        this.label,
        h('button.btn', { onclick: () => this.step(-1) }, '◀ 이전'),
        this.playBtn,
        h('button.btn', { onclick: () => this.step(1) }, '다음 ▶'),
        speedSel,
        h('button.btn.ghost', { onclick: onClose }, '닫기'),
      ),
      this.scene.el,
    );
    this.el.querySelector('.scene-controls')?.remove();
    this.show(0);
  }

  start(): void {
    this.scene.start();
  }

  dispose(): void {
    this.token++;
    this.scene.dispose();
  }

  private show(i: number): void {
    this.index = Math.max(0, Math.min(this.shots.length - 1, i));
    const s = this.shots[this.index];
    if (!s) {
      this.label.textContent = '기록된 샷이 없습니다.';
      return;
    }
    this.scene.setBalls(s.start);
    this.scene.setTurn({ interactive: false, cueBall: s.cueBall, ballInHand: null, assist: 'off' });
    const v = s.verdict;
    const name = s.state.players[s.shooter].name;
    const what = v.foul ? FOUL_LABELS[v.foul] : v.points > 0 ? `득점 +${v.points}${v.tags.includes('bankShot') ? ' (뱅크샷)' : ''}` : v.tags.includes('score') ? '성공' : '실패';
    this.label.textContent = `${this.index + 1} / ${this.shots.length} · ${name} · ${what}`;
  }

  private async playOne(): Promise<void> {
    const s = this.shots[this.index];
    if (!s) return;
    const t = ++this.token;
    this.show(this.index);
    await this.scene.playShot(s.start, s.cueBall, s.input, s.final, { speed: this.speed, onEvent: (e) => sound.event(e) });
    if (t !== this.token) return;
  }

  private async play(): Promise<void> {
    this.playing = true;
    this.playBtn.textContent = '⏸ 일시정지';
    while (this.playing && this.index < this.shots.length) {
      const t = this.token + 1;
      await this.playOne();
      if (!this.playing || t !== this.token) break;
      await new Promise((r) => setTimeout(r, 600 / this.speed));
      if (this.index >= this.shots.length - 1) break;
      this.index++;
    }
    this.pause();
  }

  private pause(): void {
    this.playing = false;
    this.playBtn.textContent = '▶ 재생';
  }

  private step(d: number): void {
    this.pause();
    this.token++;
    this.scene.skipAnimation();
    this.show(this.index + d);
  }
}
