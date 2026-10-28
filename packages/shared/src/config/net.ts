/** Online-play timing and limits shared by client and server. */
export const NET = {
  protocolVersion: 1,
  /** Room codes: length and alphabet (no 0/O/1/I to avoid typos). */
  roomCodeLength: 6,
  roomCodeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  nicknameMaxLength: 16,
  /** Opponent aim preview: max messages per second (spec: 10–20). */
  aimPreviewHz: 15,
  /** Seconds a disconnected player has to come back before the opponent may claim the win. */
  reconnectGraceSeconds: 60,
  /** Extra waiting time granted when the opponent chooses to keep waiting. */
  reconnectExtendSeconds: 60,
  /** Pause between a finished rack/set and the next one (ms). */
  setOverDelayMs: 3500,
  /** The shot clock starts after the shot animation; allowance for latency (ms). */
  clockStartSlackMs: 600,
  /** Server heartbeat interval and timeout (ms). */
  heartbeatMs: 10_000,
  /** Rooms with nobody connected are removed after this long (ms). */
  emptyRoomTtlMs: 5 * 60_000,
  /** Finished games are kept this long for reconnects/results (ms). */
  finishedRoomTtlMs: 10 * 60_000,
  /** Client reconnect backoff (ms). */
  reconnectBackoffMs: [500, 1000, 2000, 4000, 8000],
  /** Max inbound messages per second per connection before the server drops extras. */
  maxMessagesPerSecond: 60,
  maxMessageBytes: 16_384,
} as const;
