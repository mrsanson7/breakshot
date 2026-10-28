import './styles.css';
import { App } from './app';
import { storedSeat } from './session/online';

const app = new App(document.getElementById('app')!);
const code = new URL(location.href).searchParams.get('room')?.toUpperCase() ?? '';
const seat = storedSeat();
if (code && seat && seat.code === code) {
  // Refresh during a game: take the same seat back.
  app.online({ kind: 'resume', code, token: seat.token });
} else if (code) {
  app.joinRoom(code);
} else {
  app.title();
}
