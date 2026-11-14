/*
 * LoopPlayer: plays one track on repeat until stop() is called.
 * A track's URL is resolved lazily (from the Quran.com API), and failures to
 * resolve, load or keep streaming are all retried, so playback only ends when
 * the user stops it.
 */
namespace Quraan {
  const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
  const STALL_TIMEOUT_MS = 15000;

  export type PlayerState = "stopped" | "loading" | "playing" | "paused" | "retrying";
  export type PlayerEvent = "state" | "time" | "loop";

  export interface Track {
    /** Identifies the track; playing the same key again while active is a no-op. */
    key: string;
    resolveUrl(): Promise<string>;
  }

  export class LoopPlayer {
    state: PlayerState = "stopped";
    track: Track | null = null;
    src: string | null = null;
    loopCount = 0;
    retryAttempt = 0;
    retryDelayMs = 0;
    lastFailure = "";

    private retryTimer: number | null = null;
    private stallTimer: number | null = null;
    private lastTime = 0;
    private loadToken = 0;

    constructor(readonly audio: HTMLAudioElement,
                private readonly listener: (type: PlayerEvent, player: LoopPlayer) => void) {
      audio.loop = true;
      audio.preload = "auto";
      audio.addEventListener("playing", () => this.onPlaying());
      audio.addEventListener("timeupdate", () => this.onTimeUpdate());
      audio.addEventListener("ended", () => this.onEnded());
      audio.addEventListener("error", () => this.onFailure("error"));
      audio.addEventListener("waiting", () => this.armStallTimer());
      audio.addEventListener("stalled", () => this.armStallTimer());
    }

    /** Starts `track` on repeat, or resumes the current track when called without one. */
    play(track?: Track): void {
      if (track && (!this.track || track.key !== this.track.key)) {
        this.clearTimers();
        this.track = track;
        this.src = null;
        this.loopCount = 0;
        this.lastTime = 0;
        this.retryAttempt = 0;
        this.audio.pause();
        this.setState("loading");
        this.load(0);
        return;
      }
      if (!this.track || this.state === "playing" || this.state === "loading" || this.state === "retrying") {
        return;
      }
      if (!this.src) {
        this.setState("loading");
        this.load(0);
        return;
      }
      this.setState(this.state === "paused" ? "playing" : "loading");
      this.startPlayback();
    }

    pause(): void {
      if (this.state === "stopped") { return; }
      this.loadToken++;
      this.clearTimers();
      this.audio.pause();
      this.setState("paused");
    }

    toggle(): void {
      if (this.state === "playing" || this.state === "loading" || this.state === "retrying") {
        this.pause();
      } else {
        this.play();
      }
    }

    stop(): void {
      this.loadToken++;
      this.clearTimers();
      this.audio.pause();
      try { this.audio.currentTime = 0; } catch (e) { /* not seekable yet */ }
      this.loopCount = 0;
      this.lastTime = 0;
      this.retryAttempt = 0;
      this.setState("stopped");
    }

    isActive(): boolean {
      return this.state !== "stopped";
    }

    private load(resumeAt: number): void {
      const token = ++this.loadToken;
      const track = this.track!;
      track.resolveUrl().then((url) => {
        if (token !== this.loadToken || this.state !== "loading") { return; }
        this.src = url;
        this.lastTime = resumeAt;
        this.audio.src = url;
        this.audio.load();
        if (resumeAt > 0) {
          const seekOnce = () => {
            this.audio.removeEventListener("loadedmetadata", seekOnce);
            if (resumeAt < (this.audio.duration || 0)) {
              try { this.audio.currentTime = resumeAt; } catch (e) { /* ignore */ }
            }
          };
          this.audio.addEventListener("loadedmetadata", seekOnce);
        }
        this.startPlayback();
      }, () => {
        if (token === this.loadToken) { this.onFailure("resolve"); }
      });
    }

    private startPlayback(): void {
      const result = this.audio.play() as Promise<void> | undefined;
      if (result && typeof result.then === "function") {
        result.then(null, (err: { name?: string }) => {
          if (err && err.name === "AbortError") { return; }
          this.onFailure("play-rejected");
        });
      }
    }

    private onPlaying(): void {
      if (this.state === "stopped" || this.state === "paused") { return; }
      this.clearStallTimer();
      this.retryAttempt = 0;
      this.setState("playing");
    }

    private onTimeUpdate(): void {
      const t = this.audio.currentTime;
      if (this.state === "playing" && t + 1 < this.lastTime) {
        this.loopCount += 1;
        this.emit("loop");
      }
      this.lastTime = t;
      if (this.state === "playing") { this.clearStallTimer(); }
      this.emit("time");
    }

    // Some TV media pipelines ignore `loop`; restart manually as a fallback.
    private onEnded(): void {
      if (this.state === "stopped" || this.state === "paused") { return; }
      this.loopCount += 1;
      this.lastTime = 0;
      this.emit("loop");
      try { this.audio.currentTime = 0; } catch (e) { /* ignore */ }
      this.startPlayback();
    }

    private onFailure(reason: string): void {
      if (this.state === "stopped" || this.state === "paused" || !this.track) { return; }
      if (this.retryTimer !== null) { return; }
      this.clearStallTimer();
      const delay = RETRY_DELAYS_MS[Math.min(this.retryAttempt, RETRY_DELAYS_MS.length - 1)];
      this.retryAttempt += 1;
      this.retryDelayMs = delay;
      this.lastFailure = reason;
      this.loadToken++;
      this.setState("retrying");
      const resumeAt = this.src ? this.audio.currentTime || 0 : 0;
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = null;
        if (this.state !== "retrying") { return; }
        this.setState("loading");
        this.load(resumeAt);
      }, delay);
    }

    private armStallTimer(): void {
      if (this.state !== "playing" && this.state !== "loading") { return; }
      if (this.stallTimer !== null) { return; }
      this.stallTimer = window.setTimeout(() => {
        this.stallTimer = null;
        this.onFailure("stalled");
      }, STALL_TIMEOUT_MS);
    }

    private clearStallTimer(): void {
      if (this.stallTimer !== null) { clearTimeout(this.stallTimer); this.stallTimer = null; }
    }

    private clearTimers(): void {
      this.clearStallTimer();
      if (this.retryTimer !== null) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    }

    private setState(state: PlayerState): void {
      if (this.state === state) { return; }
      this.state = state;
      this.emit("state");
    }

    private emit(type: PlayerEvent): void {
      this.listener(type, this);
    }
  }
}
