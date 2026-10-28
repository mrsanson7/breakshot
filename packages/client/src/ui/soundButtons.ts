import { sound } from '../audio/sound';
import { h } from './dom';

/** 효과음 / 배경음악 켜기·끄기 버튼 두 개. `long` adds words for the title screen. */
export function soundButtons(long = false): HTMLButtonElement[] {
  const sfx = h('button.btn.ghost', { title: '효과음 켜기/끄기' }) as HTMLButtonElement;
  const bgm = h('button.btn.ghost', { title: '배경음악 켜기/끄기' }) as HTMLButtonElement;
  const render = () => {
    sfx.textContent = `${sound.muted ? '🔇' : '🔊'}${long ? (sound.muted ? ' 효과음 꺼짐' : ' 효과음 켜짐') : ''}`;
    bgm.textContent = `🎵${long ? (sound.musicOn ? ' 음악 켜짐' : ' 음악 꺼짐') : ''}`;
    bgm.classList.toggle('off', !sound.musicOn);
  };
  sfx.addEventListener('click', () => {
    sound.setMuted(!sound.muted);
    render();
  });
  bgm.addEventListener('click', () => {
    sound.setMusic(!sound.musicOn);
    render();
  });
  render();
  return [sfx, bgm];
}
