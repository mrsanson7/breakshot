import type { MatchState } from '@breakshot/shared';
import { PracticeSession } from './session/practice';
import type { Session, ShotPlayback } from './session/types';
import { sound } from './audio/sound';
import { clear, h } from './ui/dom';
import { GameScreen } from './ui/gameScreen';
import { resultScreen } from './ui/resultScreen';
import { setupForm } from './ui/setupForm';
import { OnlineSession, type OnlineIntent } from './session/online';
import { joinForm, LobbyScreen } from './ui/lobbyScreen';
import { LagScreen } from './ui/lagScreen';
import { ReplayScreen } from './ui/replayScreen';

/** Keep ?room=CODE in the address bar so a refresh resumes the game. */
export function setRoomInUrl(code: string | null): void {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

/** Screen flow: 타이틀 → (방 만들기 / 방 참가 / 연습 모드) → 대기실 → 게임 → 결과. */
export class App {
  private game: GameScreen | null = null;

  constructor(private readonly root: HTMLElement) {}

  private replay: ReplayScreen | null = null;

  private mount(el: HTMLElement): void {
    this.game?.dispose();
    this.game = null;
    this.replay?.dispose();
    this.replay = null;
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
    this.mount(
      setupForm(
        'online',
        (r) => this.online({ kind: 'create', settings: r.settings, nickname: r.names[0] }),
        () => this.title(),
        this.nickname(),
      ),
    );
  }

  joinRoom(code = '', error = ''): void {
    this.mount(
      joinForm(
        code,
        this.nickname(),
        (c, n) => {
          this.saveNickname(n);
          this.online({ kind: 'join', code: c, nickname: n });
        },
        () => {
          setRoomInUrl(null);
          this.title();
        },
        error,
      ),
    );
  }

  private nickname(): string {
    try {
      return localStorage.getItem('breakshot.nickname') ?? '';
    } catch {
      return '';
    }
  }

  private saveNickname(n: string): void {
    try {
      localStorage.setItem('breakshot.nickname', n);
    } catch {
      // ignore
    }
  }

  /** Online flow for one room: connecting → lobby → (lag) → game → result → (rematch). */
  online(intent: OnlineIntent): void {
    if (intent.kind === 'create') this.saveNickname(intent.nickname);
    const session = new OnlineSession(intent);
    let view: 'connecting' | 'lobby' | 'lag' | 'game' | 'result' = 'connecting';
    let lobby: LobbyScreen | null = null;
    let lag: LagScreen | null = null;
    const leave = () => {
      session.leave();
      setRoomInUrl(null);
      this.title();
    };
    const status = h('p.muted', {}, '서버에 연결하는 중…');
    this.mount(h('div.screen.title', {}, h('h2', {}, 'Break Shot'), status, h('button.btn', { onclick: leave }, '취소')));

    session.onRoom({
      room: (room, seat) => {
        setRoomInUrl(room.code);
        if (room.phase === 'lobby') {
          if (view !== 'lobby' || !lobby) {
            lag?.dispose();
            lag = null;
            lobby = new LobbyScreen(room, seat, { ready: (r) => session.setReady(r), leave });
            this.mount(lobby.el);
            view = 'lobby';
          } else lobby.update(room);
        } else if (room.phase === 'lag') {
          if (view !== 'lag' || !lag) {
            lag = new LagScreen(room, seat, { shoot: (input) => session.lagShot(input), leave });
            this.mount(lag.el);
            lag.start();
            for (const r of room.lag) if (r) lag.onLag(r);
            view = 'lag';
          } else lag.reset(room);
        } else if (room.phase === 'playing') {
          if (view !== 'game' && session.hasMatch && session.state.phase !== 'GameOver') {
            lag?.dispose();
            lag = null;
            this.play(session);
            view = 'game';
          }
        } else if (room.phase === 'finished') {
          // Joined/resumed straight into a finished game: show the result.
          if ((view === 'connecting' || view === 'lobby' || view === 'lag') && session.hasMatch) {
            this.result(session, session.state, []);
            view = 'result';
          }
        }
      },
      lag: (r) => lag?.onLag(r),
      error: (code, message) => {
        if (view === 'connecting') {
          session.close();
          if (intent.kind === 'resume' || code === 'roomNotFound' || code === 'roomFull') this.joinRoom(intent.kind === 'join' ? intent.code : '', message);
          else this.joinRoom('', message);
        } else if (view !== 'game') {
          status.textContent = message;
        }
      },
      status: (s) => {
        if (view === 'connecting') status.textContent = s === 'open' ? '방에 들어가는 중…' : '서버에 연결하는 중…';
      },
    });
    // Remember the result screen so a rematch can replace it.
    this.onResult = () => (view = 'result');
  }

  private onResult: (() => void) | null = null;

  play(session: Session): void {
    const screen = new GameScreen(session, {
      onExit: () => {
        setRoomInUrl(null);
        this.title();
      },
      onGameOver: (state, history) => this.result(session, state, history),
    });
    this.mount(screen.el);
    this.game = screen;
    screen.start();
  }

  result(session: Session, state: MatchState, history: ShotPlayback[]): void {
    this.onResult?.();
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
          setRoomInUrl(null);
          this.title();
        },
        replay: () => {
          const replay = new ReplayScreen(session.settings, history, () => this.result(session, state, history));
          this.mount(replay.el);
          this.replay = replay;
          replay.start();
        },
      }),
    );
  }
}
