import { defaultSettings, type RoomSettings, type ServerMessage } from '@breakshot/shared';
import type { Conn } from '../src/rooms/room';

export class FakeConn implements Conn {
  static next = 0;
  readonly id = `c${FakeConn.next++}`;
  readonly inbox: ServerMessage[] = [];
  send(msg: ServerMessage): void {
    this.inbox.push(msg);
  }
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i--) if (this.inbox[i].type === type) return this.inbox[i] as Extract<ServerMessage, { type: T }>;
    return undefined;
  }
  all<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.inbox.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }
}

export function settings(patch: Partial<RoomSettings> = {}, config: object = {}): RoomSettings {
  const s = defaultSettings('threeCushion', 'umb3c');
  return { ...s, ...patch, config: { ...s.config, ...config } } as RoomSettings;
}
