import type { MatchState } from '@breakshot/shared';
import { PracticeSession } from './session/practice';
import type { Session, ShotPlayback } from './session/types';
import { sound } from './audio/sound';
import { clear, h } from './ui/dom';
import { GameScreen } from './ui/gameScreen';
import { resultScreen } from './ui/resultScreen';
import { setupForm } from './ui/setupForm';

/** Screen flow: 타이틀 → (방 만들기 / 방 참가 / 연습 모드) → 대기실 → 게임 → 결과. */
export class App {
  private game: GameScreen | null = null;

  constructor(private readonly root: HTMLElement) {}

  private mount(el: HTMLElement): void {
    this.game?.dispose();
    this.game = null;
    clear(this.root);
    this.root.append(el);
  }

  title(): void {
    const mute = h('button.btn.ghost.mute', {}, sound.muted ? '🔇 소리 꺼짐' : '🔊 소리 켜짐');
    mute.addEventListener('click', () => {
      sound.setMuted(!sound.muted);
      mute.textContent = sound.muted ? '🔇 소리 꺼짐' : '🔊 소리 켜짐';
    });
    this.mount(
      h(
        'div.screen.title',
        {},
        h('div.logo', {}, h('span.logo-ball'), h('h1', {}, 'Break Shot')),
        h('p.tagline', {}, '포켓볼 · 3쿠션 · 4구 — 계산한 대로 굴러가는 손맛'),
        h(
          'div.menu',
          {},
          h('button.btn.primary.big', { onclick: () => this.createRoom() }, '방 만들기'),
          h('button.btn.big', { onclick: () => this.joinRoom() }, '방 참가'),
          h('button.btn.big', { onclick: () => this.practice() }, '연습 모드'),
        ),
        mute,
      ),
    );
  }

  practice(): void {
    this.mount(
      setupForm(
        'practice',
        (r) => this.play(new PracticeSession(r.settings, { freePlay: r.freePlay, names: r.names })),
        () => this.title(),
      ),
    );
  }

  createRoom(): void {
    this.mount(h('div.screen', {}, h('p', {}, '온라인 대전은 M7에서 연결됩니다.'), h('button.btn', { onclick: () => this.title() }, '← 뒤로')));
  }

  joinRoom(): void {
    this.createRoom();
  }

  play(session: Session): void {
    const screen = new GameScreen(session, {
      onExit: () => this.title(),
      onGameOver: (state, history) => this.result(session, state, history),
    });
    this.mount(screen.el);
    this.game = screen;
    screen.start();
  }

  result(session: Session, state: MatchState, history: ShotPlayback[]): void {
    this.mount(
      resultScreen(session, state, history, {
        again: () => {
          if (session.restart) {
            session.restart();
            this.play(session);
          } else session.requestRematch?.();
        },
        home: () => {
          session.leave();
          this.title();
        },
      }),
    );
  }
}
