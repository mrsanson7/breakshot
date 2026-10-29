import type { AimPrediction, BallPosition, Vec2 } from '@breakshot/shared';

export interface CueOverlay {
  /** Cue ball centre. */
  at: Vec2;
  /** Shot direction (world radians). */
  angle: number;
  /** 0..1 — how far the cue is drawn back (power). */
  pull: number;
  /** Tip offset on the ball (−1..1), to place the tip where the player is hitting. */
  spinX?: number;
  spinY?: number;
  /** Cue elevation chosen by the player (deg); the drawn cue is raised further to clear the rail. */
  elevation?: number;
  /** Opponent's cue: drawn translucent. */
  ghost?: boolean;
}

export interface PlacementOverlay {
  at: Vec2;
  valid: boolean;
}

export interface FloatingText {
  at: Vec2;
  text: string;
  color: string;
  /** 0..1, fades out towards 1. */
  age: number;
  size?: number;
}

export interface RenderFrame {
  balls: readonly BallPosition[];
  cue?: CueOverlay;
  aim?: AimPrediction;
  placement?: PlacementOverlay;
  /** Ball to outline (the active player's cue ball). */
  highlight?: string;
  texts?: FloatingText[];
  /** Short-lived rings (pocket drop, collisions). */
  rings?: { at: Vec2; age: number; color: string }[];
  /** Balls are rolling (cue view pulls back to an overview). */
  animating?: boolean;
  /** Keep the camera still (the player is dragging the cue ball). */
  holdCamera?: boolean;
}

export type CameraMode = 'top' | 'cue';

/** Screen (CSS px, canvas-relative) ↔ table (m) mapping used by the input code. */
export interface ScreenMapper {
  toWorld(p: Vec2): Vec2;
  toScreen(p: Vec2): Vec2;
}
