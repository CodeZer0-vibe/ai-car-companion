export class GeminiReconnectScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;

  public clear() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public schedule(delayMs: number, callback: () => void) {
    this.clear();
    this.timer = setTimeout(() => {
      this.timer = null;
      callback();
    }, delayMs);
  }
}
