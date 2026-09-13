export interface CandidateApp {
  start(
    source: string,
    signal: AbortSignal,
    log: (output: string) => void,
  ): Promise<void>;
  browserAction(action: unknown): Promise<any>;
  close(): Promise<void>;
}

// Fail closed before stopping the old process. start() builds, starts and probes
// health; browser initialization then creates an entirely new isolated session.
export class CandidateSession<T extends CandidateApp> {
  app: T;
  testedRevision = "";
  environment: "baseline" | "candidate" = "baseline";
  private ready = false;
  private source = "";
  constructor(
    private create: () => T,
    private calculateRevision: (source: string) => string,
  ) {
    this.app = create();
  }
  async start(
    source: string,
    environment: "baseline" | "candidate",
    buyer: string,
    signal: AbortSignal,
    log: (output: string) => void,
  ) {
    this.ready = false;
    this.testedRevision = "";
    await this.app.close();
    this.app = this.create();
    const expected = this.calculateRevision(source);
    await this.app.start(source, signal, log);
    if (this.calculateRevision(source) !== expected)
      throw new Error("Candidate changed during build");
    const initial = await this.app.browserAction({
      action: "init",
      buyer,
      safeOnly: true,
    });
    if (!initial.ok) throw new Error("Fresh browser initialization failed");
    if (this.calculateRevision(source) !== expected)
      throw new Error(
        "Source changed during browser initialization; evidence refused",
      );
    this.environment = environment;
    this.source = source;
    this.testedRevision = expected;
    this.ready = true;
    return initial;
  }
  async browserAction(action: unknown) {
    if (!this.ready)
      throw new Error("Candidate is not built and healthy; retest refused");
    if (this.calculateRevision(this.source) !== this.testedRevision) {
      this.ready = false;
      throw new Error(
        "Source revision changed; rebuild required before retesting",
      );
    }
    const observed = await this.app.browserAction(action);
    if (this.calculateRevision(this.source) !== this.testedRevision) {
      this.ready = false;
      throw new Error("Source changed during browser action; evidence refused");
    }
    return observed;
  }
  provenance() {
    return {
      environment: this.environment,
      testedRevision: this.testedRevision,
    };
  }
}
