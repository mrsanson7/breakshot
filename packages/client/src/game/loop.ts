/**
 * Fixed-timestep loop: physics advances in exact `dt` steps, rendering runs once per animation
 * frame and receives the interpolation factor between the last two physics states.
 */
export class FixedLoop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  /** Physics steps executed in the last frame (diagnostics). */
  stepsLastFrame = 0;
  fps = 60;

  constructor(
    private readonly dt: number,
    private readonly update: () => void,
    private readonly render: (alpha: number, frameDt: number) => void,
    /** Clamp after tab switches so we never try to catch up seconds of simulation at once. */
    private readonly maxFrame = 0.1,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    const frameDt = Math.min(this.maxFrame, (now - this.last) / 1000);
    this.last = now;
    if (frameDt > 0) this.fps = this.fps * 0.95 + (1 / frameDt) * 0.05;
    this.acc += frameDt;
    let steps = 0;
    while (this.acc >= this.dt) {
      this.update();
      this.acc -= this.dt;
      steps++;
    }
    this.stepsLastFrame = steps;
    this.render(this.acc / this.dt, frameDt);
    this.raf = requestAnimationFrame(this.frame);
  };
}
