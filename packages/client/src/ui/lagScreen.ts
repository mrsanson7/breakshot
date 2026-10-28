import { DISCIPLINES, geometryOf, lagStart, lagWinner, type LagResult, type RoomView, type Seat } from '@breakshot/shared';
import { GameScene } from '../game/scene';
import { sound } from '../audio/sound';
import { h } from './dom';

/** 뱅킹 (lag): each player shoots their ball to the foot cushion and back. */
export class LagScreen {
  readonly el: HTMLDivElement;
  readonly scene: GameScene;
  private info = h('div.lag-info');
  private shown: [LagResult | null, LagResult | null] = [null, null];
  private carom: boolean;
  private room: RoomView;

  constructor(
    room: RoomView,
    private readonly mySeat: Seat,
    private readonly actions: { shoot(input: { angle: number; power: number; spinX: number; spinY: number }): void; leave(): void },
  ) {
    this.room = room;
    const s = room.settings;
    this.carom = DISCIPLINES[s.discipline].physics === 'carom';
    this.scene = new GameScene(s.table, s.discipline, {
      onShoot: (req) => {
        sound.cue(req.input.power);
        this.actions.shoot(req.input);
        this.info.textContent = '상대의 뱅킹을 기다리는 중…';
      },
    });
    this.scene.setFelt(s.felt);
    this.el = h(
      'div.game.lag',
      {},
      h('div.lag-head', {}, h('strong', {}, '뱅킹 (선공 결정)'), this.info, h('button.btn.ghost', { onclick: () => this.actions.leave() }, '나가기')),
      this.scene.el,
    );
    this.reset(room);
    if (import.meta.env.DEV) (window as unknown as { __lag: LagScreen }).__lag = this;
  }

  start(): void {
    this.scene.start();
  }

  dispose(): void {
    this.scene.dispose();
  }

  private startBalls() {
    const geom = geometryOf(this.room.settings.table);
    return ([0, 1] as Seat[]).map((seat) => {
      const r = this.shown[seat];
      return r ? r.final : lagStart(geom, seat, this.carom);
    });
  }

  /** New lag round (first time or after a tie). */
  reset(room: RoomView): void {
    this.room = room;
    if (room.lag[0] === null && room.lag[1] === null && (this.shown[0] || this.shown[1] || this.sent)) {
      // Re-lag after a tie.
      this.shown = [null, null];
      this.sent = false;
      this.held = null;
    }
    this.scene.setBalls(this.startBalls());
    if (!this.sent) {
      this.enableMine();
      this.info.textContent = '오른쪽 짧은 쿠션을 맞고 돌아와 왼쪽 쿠션에 더 가깝게 멈추면 선공입니다.';
    }
  }

  private chain: Promise<void> = Promise.resolve();
  private sent = false;

  private enableMine(): void {
    if (this.sent || this.shown[this.mySeat]) return;
    const ball = lagStart(geometryOf(this.room.settings.table), this.mySeat, this.carom).id;
    this.scene.setTurn({ interactive: true, cueBall: ball, ballInHand: null, assist: 'off' });
  }

  private held: LagResult | null = null;

  /**
   * Animate lag results one after the other. The opponent's lag is held back until we have shot
   * ourselves: it would block our controls and reveal their distance first.
   */
  onLag(r: LagResult): void {
    if (r.seat !== this.mySeat && !this.sent) {
      this.held = r;
      this.info.textContent = `${this.room.seats[r.seat]?.nickname ?? '상대'} 뱅킹 완료 — 이제 치세요.`;
      return;
    }
    if (r.seat === this.mySeat) this.sent = true;
    this.chain = this.chain.then(() => this.play(r));
    if (this.held && this.sent) {
      const h = this.held;
      this.held = null;
      this.chain = this.chain.then(() => this.play(h));
    }
  }

  private async play(r: LagResult): Promise<void> {
    if (this.shown[r.seat]) return;
    const others = this.startBalls().filter((b) => b.id !== r.ballId);
    await this.scene.playShot([r.start], r.ballId, r.input, [r.final], { onEvent: (e) => sound.event(e), extraBalls: others });
    this.shown[r.seat] = r;
    this.scene.setBalls([...others, r.final]);
    const label = r.distance === null ? '무효' : `${(r.distance * 100).toFixed(1)}cm`;
    this.scene.floatText(r.final, label, r.distance === null ? '#ff5468' : '#ffffff', 4, 22);
    const [a, b] = this.shown;
    if (a && b) {
      const w = lagWinner(a.distance, b.distance);
      this.info.textContent = w === null ? '무승부 — 다시 뱅킹합니다.' : `${this.room.seats[w]?.nickname} 선공!`;
    } else {
      this.info.textContent = '상대의 뱅킹을 기다리는 중…';
    }
  }
}
