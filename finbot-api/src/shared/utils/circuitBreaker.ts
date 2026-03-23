type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface Options {
  failureThreshold?: number; // failures before opening (default 5)
  probeInterval?: number;    // ms before probing from OPEN (default 30000)
  successThreshold?: number; // successes to close from HALF_OPEN (default 2)
}

export class CircuitBreaker {
  private state: State = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private openedAt = 0;

  private readonly failureThreshold: number;
  private readonly probeInterval: number;
  private readonly successThreshold: number;

  constructor(
    private readonly name: string,
    opts: Options = {},
  ) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.probeInterval = opts.probeInterval ?? 30_000;
    this.successThreshold = opts.successThreshold ?? 2;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.openedAt < this.probeInterval) {
        throw new Error(`Circuit ${this.name} is OPEN`);
      }
      this.state = 'HALF_OPEN';
      this.successes = 0;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.successThreshold) this.state = 'CLOSED';
    }
  }

  private onFailure(): void {
    this.failures++;
    if (this.failures >= this.failureThreshold || this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.openedAt = Date.now();
      this.failures = 0;
    }
  }

  get currentState(): State {
    return this.state;
  }
}
