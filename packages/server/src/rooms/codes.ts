import { randomBytes, randomInt } from 'node:crypto';
import { NET } from '@breakshot/shared';

export function roomCode(): string {
  let s = '';
  for (let i = 0; i < NET.roomCodeLength; i++) s += NET.roomCodeAlphabet[randomInt(NET.roomCodeAlphabet.length)];
  return s;
}

/** Opaque reconnect token (per seat). */
export function sessionToken(): string {
  return randomBytes(18).toString('base64url');
}
