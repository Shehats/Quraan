namespace Quraan {
  const KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 10009, ESCAPE: 27, BACKSPACE: 8, SPACE: 32,
    PLAY: 415, PAUSE: 19, PLAY_PAUSE: 10252, STOP: 413,
    REWIND: 412, FAST_FORWARD: 417, PREV: 10232, NEXT: 10233
  };
  const MEDIA_KEYS = [
    "MediaPlay", "MediaPause", "MediaPlayPause", "MediaStop",
    "MediaRewind", "MediaFastForward", "MediaTrackPrevious", "MediaTrackNext",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"
  ];
  const STORAGE_KEY = "quraan.selection";
  const NUMBER_ENTRY_DELAY_MS = 1500;
  const CATALOG_RETRY_MS = 5000;
  const DEFAULT_RECITER_ID = 7; // Mishari Rashid al-`Afasy

  type Zone = "reciters" | "surahs" | "controls";

  interface Selection { reciterId?: number; surah?: number; }

  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  const els = {
    reciterList: $("reciter-list"),
    surahList: $("surah-list"),
    controls: $("controls"),
    state: $("np-state"),
    surahAr: $("np-surah-ar"),
    surah: $("np-surah"),
    reciter: $("np-reciter"),
    fill: $("np-progress-fill"),
    elapsed: $("np-elapsed"),
    duration: $("np-duration"),
    loops: $("np-loops"),
    toggle: $("btn-toggle"),
    numberEntry: $("number-entry"),
    clock: $("clock")
  };

  let surahs: Surah[] = [];
  let reciters: Reciter[] = [];
  let catalogError = false;

  const saved = loadSelection();
  const ui = {
    zone: "surahs" as Zone,
    zones: ["reciters", "surahs", "controls"] as Zone[],
    index: { reciters: 0, surahs: 0, controls: 0 } as { [z in Zone]: number },
    reciterIndex: 0,
    surahIndex: 0,
    playingSurahIndex: -1,
    playingReciterIndex: -1,
    numberBuffer: "",
    numberTimer: 0
  };

  const player = new LoopPlayer($("audio") as HTMLAudioElement, onPlayerEvent);

  // ---------- Catalog (Quran.com API) ----------

  function loadCatalog(): void {
    Promise.all([fetchSurahs(), fetchReciters()]).then(function (result) {
      surahs = result[0];
      reciters = result[1];
      catalogError = false;
      ui.reciterIndex = Math.max(0, indexOfReciter(saved.reciterId || DEFAULT_RECITER_ID));
      ui.surahIndex = clamp((saved.surah || 1) - 1, 0, surahs.length - 1);
      ui.index.reciters = ui.reciterIndex;
      ui.index.surahs = ui.surahIndex;
      buildLists();
      render();
    }, function () {
      catalogError = true;
      buildLists();
      render();
      setTimeout(loadCatalog, CATALOG_RETRY_MS);
    });
  }

  function trackFor(reciter: Reciter, surah: Surah): Track {
    return {
      key: reciter.id + ":" + surah.number,
      resolveUrl: function () { return fetchAudioUrl(reciter.id, surah.number); }
    };
  }

  function hasCatalog(): boolean {
    return surahs.length > 0 && reciters.length > 0;
  }

  // ---------- Rendering ----------

  function buildLists(): void {
    if (!hasCatalog()) {
      els.reciterList.innerHTML = placeholder(catalogError ? "Retrying\u2026" : "Loading\u2026");
      els.surahList.innerHTML = placeholder(catalogError
        ? "Can\u2019t reach Quran.com \u2014 retrying\u2026"
        : "Loading from Quran.com\u2026");
      return;
    }

    let html = "";
    for (let i = 0; i < reciters.length; i++) {
      const r = reciters[i];
      html += '<li class="item" data-index="' + i + '"><span class="name">' + escapeHtml(r.name) + "</span>" +
        (r.style ? '<span class="meta">' + escapeHtml(r.style) + "</span>" : "") + "</li>";
    }
    els.reciterList.innerHTML = html;

    html = "";
    for (let j = 0; j < surahs.length; j++) {
      const s = surahs[j];
      html += '<li class="item" data-index="' + j + '">' +
        '<span class="num">' + s.number + "</span>" +
        '<span class="name">' + escapeHtml(s.name) + "</span>" +
        '<span class="meta">' + s.verses + " ayat</span>" +
        '<span class="ar" lang="ar" dir="rtl">' + escapeHtml(s.arabic) + "</span></li>";
    }
    els.surahList.innerHTML = html;
  }

  function placeholder(text: string): string {
    return '<li class="item placeholder"><span class="name">' + text + "</span></li>";
  }

  function listFor(zone: Zone): HTMLCollection {
    if (zone === "reciters") { return els.reciterList.children; }
    if (zone === "surahs") { return els.surahList.children; }
    return els.controls.children;
  }

  function render(): void {
    if (hasCatalog()) {
      renderList("reciters", ui.reciterIndex, -1);
      renderList("surahs", ui.surahIndex, player.isActive() ? ui.playingSurahIndex : -1);
    }
    const controls = listFor("controls");
    for (let c = 0; c < controls.length; c++) {
      toggleClass(controls[c], "focused", ui.zone === "controls" && ui.index.controls === c);
    }
    toggleClass(els.reciterList, "focus-zone", ui.zone === "reciters");
    toggleClass(els.surahList, "focus-zone", ui.zone === "surahs");
    renderNowPlaying();
  }

  function renderList(zone: Zone, selectedIndex: number, playingIndex: number): void {
    const items = listFor(zone);
    const focusIndex = ui.index[zone];
    for (let i = 0; i < items.length; i++) {
      toggleClass(items[i], "focused", i === focusIndex);
      toggleClass(items[i], "selected", i === selectedIndex);
      toggleClass(items[i], "playing", i === playingIndex);
    }
    keepInView(zone === "reciters" ? els.reciterList : els.surahList, items[focusIndex] as HTMLElement);
  }

  function keepInView(container: HTMLElement, item: HTMLElement | undefined): void {
    if (!item) { return; }
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < container.scrollTop) {
      container.scrollTop = top;
    } else if (bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = bottom - container.clientHeight;
    }
  }

  const STATE_LABELS: { [s in PlayerState]: string } = {
    stopped: "Stopped",
    loading: "Loading\u2026",
    playing: "Playing on repeat",
    paused: "Paused",
    retrying: "Reconnecting\u2026"
  };

  function renderNowPlaying(): void {
    els.state.textContent = STATE_LABELS[player.state];
    els.state.setAttribute("data-state", player.state);
    els.toggle.textContent = player.state === "playing" || player.state === "loading" ||
      player.state === "retrying" ? "Pause" : "Play";

    if (!hasCatalog()) {
      els.surahAr.textContent = "";
      els.surah.textContent = catalogError ? "Waiting for Quran.com\u2026" : "Loading surahs\u2026";
      els.reciter.textContent = "";
      els.loops.textContent = "";
      renderTime();
      return;
    }

    const active = player.isActive();
    const surah = surahs[active ? ui.playingSurahIndex : ui.surahIndex];
    const reciter = reciters[active ? ui.playingReciterIndex : ui.reciterIndex];
    els.surahAr.textContent = surah.arabic;
    els.surah.textContent = surah.number + ". " + surah.name + " \u2014 " + surah.meaning;
    els.reciter.textContent = reciter.name + (reciter.style ? " \u00b7 " + reciter.style : "");

    if (!active) {
      els.loops.textContent = "Repeats until you press Stop";
    } else if (player.state === "retrying") {
      els.loops.textContent = "Connection lost \u2014 retrying in " +
        Math.round(player.retryDelayMs / 1000) + "s";
    } else {
      els.loops.textContent = "Repeat #" + (player.loopCount + 1) +
        (player.loopCount ? "  \u00b7  completed " + player.loopCount + "\u00d7" : "");
    }
    renderTime();
  }

  function renderTime(): void {
    const audio = player.audio;
    const showTime = player.state === "playing" || player.state === "paused";
    const duration = showTime && isFinite(audio.duration) ? audio.duration : 0;
    const current = showTime ? audio.currentTime : 0;
    els.elapsed.textContent = formatTime(current);
    els.duration.textContent = formatTime(duration);
    els.fill.style.width = (duration ? Math.min(100, (current / duration) * 100) : 0) + "%";
  }

  function renderClock(): void {
    const d = new Date();
    const h = d.getHours();
    const m = d.getMinutes();
    els.clock.textContent = (h % 12 || 12) + ":" + (m < 10 ? "0" : "") + m + (h < 12 ? " AM" : " PM");
  }

  // ---------- Actions ----------

  function playSurah(index: number): void {
    if (!hasCatalog()) { return; }
    ui.surahIndex = index;
    ui.index.surahs = index;
    ui.playingSurahIndex = index;
    ui.playingReciterIndex = ui.reciterIndex;
    saveSelection();
    player.play(trackFor(reciters[ui.reciterIndex], surahs[index]));
    render();
  }

  function selectReciter(index: number): void {
    ui.reciterIndex = index;
    saveSelection();
    if (player.isActive()) {
      playSurah(ui.playingSurahIndex);
    }
    render();
  }

  function togglePlayback(): void {
    if (!player.isActive()) {
      playSurah(ui.surahIndex);
    } else {
      player.toggle();
    }
  }

  function stopPlayback(): void {
    player.stop();
    render();
  }

  function stepSurah(delta: number): void {
    if (!hasCatalog()) { return; }
    const base = player.isActive() ? ui.playingSurahIndex : ui.surahIndex;
    const next = (base + delta + surahs.length) % surahs.length;
    if (player.isActive()) {
      playSurah(next);
    } else {
      ui.surahIndex = next;
      ui.index.surahs = next;
      render();
    }
  }

  function activateFocused(): void {
    const i = ui.index[ui.zone];
    if (ui.zone === "reciters") {
      if (!hasCatalog()) { return; }
      selectReciter(i);
      ui.zone = "surahs";
      render();
    } else if (ui.zone === "surahs") {
      playSurah(i);
    } else {
      const action = (listFor("controls")[i] as HTMLElement).getAttribute("data-action");
      if (action === "toggle") { togglePlayback(); } else { stopPlayback(); }
    }
  }

  function moveFocus(dx: number, dy: number): void {
    if (dx) {
      const z = ui.zones.indexOf(ui.zone) + dx;
      if (z < 0 || z >= ui.zones.length) { return; }
      ui.zone = ui.zones[z];
    } else if (ui.zone === "controls" || !hasCatalog()) {
      return;
    } else {
      const count = listFor(ui.zone).length;
      ui.index[ui.zone] = clamp(ui.index[ui.zone] + dy, 0, count - 1);
    }
    render();
  }

  function moveControlFocus(dx: number): void {
    const next = ui.index.controls + dx;
    if (next < 0) {
      ui.zone = "surahs";
    } else if (next >= listFor("controls").length) {
      return;
    } else {
      ui.index.controls = next;
    }
    render();
  }

  function handleBack(): void {
    if (ui.numberBuffer) {
      clearNumberEntry();
      return;
    }
    if (player.isActive()) {
      stopPlayback();
      return;
    }
    exitApp();
  }

  function exitApp(): void {
    try {
      tizen.application.getCurrentApplication().exit();
    } catch (e) { /* running outside a TV */ }
  }

  // ---------- Number entry (jump to surah) ----------

  function pushDigit(d: number): void {
    if (!hasCatalog()) { return; }
    if (ui.numberBuffer.length >= 3) { ui.numberBuffer = ""; }
    ui.numberBuffer += String(d);
    const n = parseInt(ui.numberBuffer, 10);
    const valid = n >= 1 && n <= surahs.length;
    els.numberEntry.innerHTML = "Surah " + ui.numberBuffer +
      "<small>" + (valid ? escapeHtml(surahs[n - 1].name) : "Enter 1\u2013" + surahs.length) + "</small>";
    removeClass(els.numberEntry, "hidden");
    clearTimeout(ui.numberTimer);
    ui.numberTimer = window.setTimeout(commitNumberEntry, NUMBER_ENTRY_DELAY_MS);
  }

  function commitNumberEntry(): void {
    const n = parseInt(ui.numberBuffer, 10);
    clearNumberEntry();
    if (n >= 1 && n <= surahs.length) {
      ui.zone = "surahs";
      playSurah(n - 1);
    }
  }

  function clearNumberEntry(): void {
    clearTimeout(ui.numberTimer);
    ui.numberBuffer = "";
    addClass(els.numberEntry, "hidden");
  }

  // ---------- Input ----------

  function onKeyDown(e: KeyboardEvent): void {
    const code = e.keyCode;
    const digit = code >= 48 && code <= 57 ? code - 48 : (code >= 96 && code <= 105 ? code - 96 : -1);
    if (digit >= 0) {
      pushDigit(digit);
      e.preventDefault();
      return;
    }
    switch (code) {
      case KEY.LEFT: if (ui.zone === "controls") { moveControlFocus(-1); } else { moveFocus(-1, 0); } break;
      case KEY.RIGHT: if (ui.zone === "controls") { moveControlFocus(1); } else { moveFocus(1, 0); } break;
      case KEY.UP: moveFocus(0, -1); break;
      case KEY.DOWN: moveFocus(0, 1); break;
      case KEY.ENTER:
        if (ui.numberBuffer) { commitNumberEntry(); } else { activateFocused(); }
        break;
      case KEY.PLAY: if (!player.isActive() || player.state === "paused") { togglePlayback(); } break;
      case KEY.PAUSE: if (player.isActive()) { player.pause(); render(); } break;
      case KEY.PLAY_PAUSE: case KEY.SPACE: togglePlayback(); break;
      case KEY.STOP: stopPlayback(); break;
      case KEY.PREV: case KEY.REWIND: stepSurah(-1); break;
      case KEY.NEXT: case KEY.FAST_FORWARD: stepSurah(1); break;
      case KEY.BACK: case KEY.ESCAPE: case KEY.BACKSPACE: handleBack(); break;
      default: return;
    }
    e.preventDefault();
  }

  function registerTvKeys(): void {
    if (typeof tizen === "undefined" || !tizen.tvinputdevice) { return; }
    const input = tizen.tvinputdevice;
    try {
      input.registerKeyBatch(MEDIA_KEYS);
    } catch (e) {
      for (let i = 0; i < MEDIA_KEYS.length; i++) {
        try { input.registerKey(MEDIA_KEYS[i]); } catch (ignored) { /* unsupported key */ }
      }
    }
  }

  function setScreenSaver(allowed: boolean): void {
    try {
      const api = webapis.appcommon;
      api.setScreenSaver(allowed ? api.AppCommonScreenSaverState.SCREEN_SAVER_ON
        : api.AppCommonScreenSaverState.SCREEN_SAVER_OFF);
    } catch (e) { /* not on a Samsung TV */ }
  }

  function onPlayerEvent(type: PlayerEvent): void {
    if (type === "time") {
      renderTime();
      return;
    }
    if (type === "state") {
      setScreenSaver(player.state === "stopped" || player.state === "paused");
    }
    render();
  }

  // ---------- Helpers ----------

  function indexOfReciter(id: number): number {
    for (let i = 0; i < reciters.length; i++) {
      if (reciters[i].id === id) { return i; }
    }
    return -1;
  }

  function loadSelection(): Selection {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {}; } catch (e) { return {}; }
  }

  function saveSelection(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        reciterId: reciters[ui.reciterIndex].id,
        surah: surahs[ui.surahIndex].number
      } as Selection));
    } catch (e) { /* storage unavailable */ }
  }

  function formatTime(sec: number): string {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const mm = h ? (m < 10 ? "0" : "") + m : String(m);
    return (h ? h + ":" : "") + mm + ":" + (s < 10 ? "0" : "") + s;
  }

  function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
  function escapeHtml(s: string): string {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function hasClass(el: Element, c: string): boolean { return (" " + el.className + " ").indexOf(" " + c + " ") >= 0; }
  function addClass(el: Element, c: string): void { if (!hasClass(el, c)) { el.className = (el.className + " " + c).trim(); } }
  function removeClass(el: Element, c: string): void {
    el.className = (" " + el.className + " ").replace(" " + c + " ", " ").trim();
  }
  function toggleClass(el: Element, c: string, on: boolean): void { if (on) { addClass(el, c); } else { removeClass(el, c); } }

  // ---------- Boot ----------

  buildLists();
  registerTvKeys();
  document.addEventListener("keydown", onKeyDown);
  renderClock();
  setInterval(renderClock, 15000);
  render();
  loadCatalog();

  (window as unknown as { QuraanApp: object }).QuraanApp = {
    player: player,
    ui: ui,
    catalog: function () { return { surahs: surahs, reciters: reciters }; }
  };
}
