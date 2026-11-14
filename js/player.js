/*
 * LoopPlayer: plays one audio URL on repeat until stop() is called.
 * Recovers from network errors/stalls by reloading the stream, so playback
 * only ends when the user stops it.
 */
(function (global) {
  "use strict";

  var RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
  var STALL_TIMEOUT_MS = 15000;

  function LoopPlayer(audio, listener) {
    this.audio = audio;
    this.listener = listener || function () {};
    this.state = "stopped"; // stopped | loading | playing | paused | retrying
    this.src = null;
    this.loopCount = 0;
    this.retryAttempt = 0;
    this.retryTimer = null;
    this.stallTimer = null;
    this.lastTime = 0;

    audio.loop = true;
    audio.preload = "auto";

    var self = this;
    audio.addEventListener("playing", function () { self._onPlaying(); });
    audio.addEventListener("timeupdate", function () { self._onTimeUpdate(); });
    audio.addEventListener("ended", function () { self._onEnded(); });
    audio.addEventListener("error", function () { self._onFailure("error"); });
    audio.addEventListener("waiting", function () { self._armStallTimer(); });
    audio.addEventListener("stalled", function () { self._armStallTimer(); });
  }

  LoopPlayer.prototype.play = function (src) {
    if (src && src !== this.src) {
      this.src = src;
      this.loopCount = 0;
      this.lastTime = 0;
      this._clearTimers();
      this.retryAttempt = 0;
      this.audio.src = src;
      this.audio.load();
    } else if (!this.src) {
      return;
    }
    this._setState(this.state === "paused" ? "playing" : "loading");
    this._startPlayback();
  };

  LoopPlayer.prototype.pause = function () {
    if (this.state === "stopped") { return; }
    this._clearTimers();
    this.audio.pause();
    this._setState("paused");
  };

  LoopPlayer.prototype.toggle = function () {
    if (this.state === "playing" || this.state === "loading" || this.state === "retrying") {
      this.pause();
    } else {
      this.play();
    }
  };

  LoopPlayer.prototype.stop = function () {
    this._clearTimers();
    this.audio.pause();
    try { this.audio.currentTime = 0; } catch (e) { /* not seekable yet */ }
    this.loopCount = 0;
    this.lastTime = 0;
    this.retryAttempt = 0;
    this._setState("stopped");
  };

  LoopPlayer.prototype.isActive = function () {
    return this.state !== "stopped";
  };

  LoopPlayer.prototype._startPlayback = function () {
    var self = this;
    var result = this.audio.play();
    if (result && typeof result.then === "function") {
      result.then(null, function (err) {
        if (err && err.name === "AbortError") { return; }
        self._onFailure("play-rejected");
      });
    }
  };

  LoopPlayer.prototype._onPlaying = function () {
    if (this.state === "stopped" || this.state === "paused") { return; }
    this._clearStallTimer();
    this.retryAttempt = 0;
    this._setState("playing");
  };

  LoopPlayer.prototype._onTimeUpdate = function () {
    var t = this.audio.currentTime;
    if (this.state === "playing" && t + 1 < this.lastTime) {
      this.loopCount += 1;
      this._emit("loop");
    }
    this.lastTime = t;
    if (this.state === "playing") { this._clearStallTimer(); }
    this._emit("time");
  };

  // Some TV media pipelines ignore `loop`; restart manually as a fallback.
  LoopPlayer.prototype._onEnded = function () {
    if (this.state === "stopped" || this.state === "paused") { return; }
    this.loopCount += 1;
    this.lastTime = 0;
    this._emit("loop");
    try { this.audio.currentTime = 0; } catch (e) { /* ignore */ }
    this._startPlayback();
  };

  LoopPlayer.prototype._onFailure = function (reason) {
    if (this.state === "stopped" || this.state === "paused" || !this.src) { return; }
    if (this.retryTimer) { return; }
    this._clearStallTimer();
    var delay = RETRY_DELAYS_MS[Math.min(this.retryAttempt, RETRY_DELAYS_MS.length - 1)];
    this.retryAttempt += 1;
    this.retryDelayMs = delay;
    this.lastFailure = reason;
    this._setState("retrying");
    var self = this;
    var resumeAt = this.audio.currentTime || 0;
    this.retryTimer = setTimeout(function () {
      self.retryTimer = null;
      if (self.state !== "retrying") { return; }
      self.audio.src = self.src;
      self.audio.load();
      var seekOnce = function () {
        self.audio.removeEventListener("loadedmetadata", seekOnce);
        if (resumeAt > 0 && resumeAt < (self.audio.duration || 0)) {
          try { self.audio.currentTime = resumeAt; } catch (e) { /* ignore */ }
        }
      };
      self.audio.addEventListener("loadedmetadata", seekOnce);
      self._startPlayback();
    }, delay);
  };

  LoopPlayer.prototype._armStallTimer = function () {
    if (this.state !== "playing" && this.state !== "loading") { return; }
    if (this.stallTimer) { return; }
    var self = this;
    this.stallTimer = setTimeout(function () {
      self.stallTimer = null;
      self._onFailure("stalled");
    }, STALL_TIMEOUT_MS);
  };

  LoopPlayer.prototype._clearStallTimer = function () {
    if (this.stallTimer) { clearTimeout(this.stallTimer); this.stallTimer = null; }
  };

  LoopPlayer.prototype._clearTimers = function () {
    this._clearStallTimer();
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
  };

  LoopPlayer.prototype._setState = function (state) {
    if (this.state === state) { return; }
    this.state = state;
    this._emit("state");
  };

  LoopPlayer.prototype._emit = function (type) {
    this.listener(type, this);
  };

  global.LoopPlayer = LoopPlayer;
})(this);
