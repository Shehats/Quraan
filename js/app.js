(function () {
  "use strict";

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 10009, ESCAPE: 27, BACKSPACE: 8, SPACE: 32,
    PLAY: 415, PAUSE: 19, PLAY_PAUSE: 10252, STOP: 413,
    REWIND: 412, FAST_FORWARD: 417, PREV: 10232, NEXT: 10233
  };
  var MEDIA_KEYS = [
    "MediaPlay", "MediaPause", "MediaPlayPause", "MediaStop",
    "MediaRewind", "MediaFastForward", "MediaTrackPrevious", "MediaTrackNext",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"
  ];
  var STORAGE_KEY = "quraan.selection";
  var NUMBER_ENTRY_DELAY_MS = 1500;

  var $ = function (id) { return document.getElementById(id); };
  var els = {
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

  var saved = loadSelection();
  var ui = {
    zone: "surahs",
    zones: ["reciters", "surahs", "controls"],
    index: { reciters: 0, surahs: 0, controls: 0 },
    reciterIndex: Math.max(0, indexOfReciter(saved.reciterId)),
    surahIndex: clamp((saved.surah || 1) - 1, 0, SURAHS.length - 1),
    playingSurahIndex: -1,
    numberBuffer: "",
    numberTimer: null
  };
  ui.index.reciters = ui.reciterIndex;
  ui.index.surahs = ui.surahIndex;

  var player = new LoopPlayer($("audio"), onPlayerEvent);

  // ---------- Rendering ----------

  function buildLists() {
    var html = "";
    for (var i = 0; i < RECITERS.length; i++) {
      html += '<li class="item" data-index="' + i + '"><span class="name">' +
        escapeHtml(RECITERS[i].name) + "</span></li>";
    }
    els.reciterList.innerHTML = html;

    html = "";
    for (var j = 0; j < SURAHS.length; j++) {
      var s = SURAHS[j];
      html += '<li class="item" data-index="' + j + '">' +
        '<span class="num">' + s.number + "</span>" +
        '<span class="name">' + escapeHtml(s.name) + "</span>" +
        '<span class="meta">' + s.verses + " ayat</span>" +
        '<span class="ar" lang="ar" dir="rtl">' + s.arabic + "</span></li>";
    }
    els.surahList.innerHTML = html;
  }

  function listFor(zone) {
    if (zone === "reciters") { return els.reciterList.children; }
    if (zone === "surahs") { return els.surahList.children; }
    return els.controls.children;
  }

  function render() {
    renderList("reciters", ui.reciterIndex, -1);
    renderList("surahs", ui.surahIndex, player.isActive() ? ui.playingSurahIndex : -1);
    var controls = listFor("controls");
    for (var c = 0; c < controls.length; c++) {
      toggleClass(controls[c], "focused", ui.zone === "controls" && ui.index.controls === c);
    }
    toggleClass(els.reciterList, "focus-zone", ui.zone === "reciters");
    toggleClass(els.surahList, "focus-zone", ui.zone === "surahs");
    renderNowPlaying();
  }

  function renderList(zone, selectedIndex, playingIndex) {
    var items = listFor(zone);
    var focusIndex = ui.index[zone];
    for (var i = 0; i < items.length; i++) {
      toggleClass(items[i], "focused", i === focusIndex);
      toggleClass(items[i], "selected", i === selectedIndex);
      toggleClass(items[i], "playing", i === playingIndex);
    }
    keepInView(zone === "reciters" ? els.reciterList : els.surahList, items[focusIndex]);
  }

  function keepInView(container, item) {
    if (!item) { return; }
    var top = item.offsetTop;
    var bottom = top + item.offsetHeight;
    if (top < container.scrollTop) {
      container.scrollTop = top;
    } else if (bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = bottom - container.clientHeight;
    }
  }

  function renderNowPlaying() {
    var surah = SURAHS[player.isActive() ? ui.playingSurahIndex : ui.surahIndex];
    var reciter = RECITERS[ui.reciterIndex];
    els.surahAr.textContent = surah.arabic;
    els.surah.textContent = surah.number + ". " + surah.name + " \u2014 " + surah.meaning;
    els.reciter.textContent = reciter.name;

    var labels = {
      stopped: "Stopped",
      loading: "Loading\u2026",
      playing: "Playing on repeat",
      paused: "Paused",
      retrying: "Reconnecting\u2026"
    };
    els.state.textContent = labels[player.state];
    els.state.setAttribute("data-state", player.state);
    els.toggle.textContent = player.state === "playing" || player.state === "loading" ||
      player.state === "retrying" ? "Pause" : "Play";

    if (!player.isActive()) {
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

  function renderTime() {
    var audio = player.audio;
    var duration = isFinite(audio.duration) ? audio.duration : 0;
    var current = player.isActive() ? audio.currentTime : 0;
    els.elapsed.textContent = formatTime(current);
    els.duration.textContent = formatTime(duration);
    els.fill.style.width = (duration ? Math.min(100, (current / duration) * 100) : 0) + "%";
  }

  function renderClock() {
    var d = new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    els.clock.textContent = (h % 12 || 12) + ":" + (m < 10 ? "0" : "") + m + (h < 12 ? " AM" : " PM");
  }

  // ---------- Actions ----------

  function playSurah(index) {
    ui.surahIndex = index;
    ui.index.surahs = index;
    ui.playingSurahIndex = index;
    saveSelection();
    player.play(audioUrl(RECITERS[ui.reciterIndex], SURAHS[index]));
    render();
  }

  function selectReciter(index) {
    ui.reciterIndex = index;
    saveSelection();
    if (player.isActive()) {
      playSurah(ui.playingSurahIndex);
    }
    render();
  }

  function togglePlayback() {
    if (!player.isActive()) {
      playSurah(ui.surahIndex);
    } else {
      player.toggle();
    }
  }

  function stopPlayback() {
    player.stop();
    render();
  }

  function stepSurah(delta) {
    var base = player.isActive() ? ui.playingSurahIndex : ui.surahIndex;
    var next = (base + delta + SURAHS.length) % SURAHS.length;
    if (player.isActive()) {
      playSurah(next);
    } else {
      ui.surahIndex = next;
      ui.index.surahs = next;
      render();
    }
  }

  function activateFocused() {
    var i = ui.index[ui.zone];
    if (ui.zone === "reciters") {
      selectReciter(i);
      ui.zone = "surahs";
      render();
    } else if (ui.zone === "surahs") {
      playSurah(i);
    } else {
      var action = listFor("controls")[i].getAttribute("data-action");
      if (action === "toggle") { togglePlayback(); } else { stopPlayback(); }
    }
  }

  function moveFocus(dx, dy) {
    if (dx) {
      var z = ui.zones.indexOf(ui.zone) + dx;
      if (z < 0 || z >= ui.zones.length) { return; }
      ui.zone = ui.zones[z];
    } else if (ui.zone === "controls") {
      return;
    } else {
      var count = listFor(ui.zone).length;
      ui.index[ui.zone] = clamp(ui.index[ui.zone] + dy, 0, count - 1);
    }
    render();
  }

  function moveControlFocus(dx) {
    var next = ui.index.controls + dx;
    if (next < 0) {
      ui.zone = "surahs";
    } else if (next >= listFor("controls").length) {
      return;
    } else {
      ui.index.controls = next;
    }
    render();
  }

  function handleBack() {
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

  function exitApp() {
    try {
      tizen.application.getCurrentApplication().exit();
    } catch (e) { /* running outside a TV */ }
  }

  // ---------- Number entry (jump to surah) ----------

  function pushDigit(d) {
    if (ui.numberBuffer.length >= 3) { ui.numberBuffer = ""; }
    ui.numberBuffer += String(d);
    var n = parseInt(ui.numberBuffer, 10);
    var valid = n >= 1 && n <= SURAHS.length;
    els.numberEntry.innerHTML = "Surah " + ui.numberBuffer +
      "<small>" + (valid ? escapeHtml(SURAHS[n - 1].name) : "Enter 1\u2013114") + "</small>";
    removeClass(els.numberEntry, "hidden");
    clearTimeout(ui.numberTimer);
    ui.numberTimer = setTimeout(commitNumberEntry, NUMBER_ENTRY_DELAY_MS);
  }

  function commitNumberEntry() {
    var n = parseInt(ui.numberBuffer, 10);
    clearNumberEntry();
    if (n >= 1 && n <= SURAHS.length) {
      ui.zone = "surahs";
      playSurah(n - 1);
    }
  }

  function clearNumberEntry() {
    clearTimeout(ui.numberTimer);
    ui.numberBuffer = "";
    addClass(els.numberEntry, "hidden");
  }

  // ---------- Input ----------

  function onKeyDown(e) {
    var code = e.keyCode;
    var digit = code >= 48 && code <= 57 ? code - 48 : (code >= 96 && code <= 105 ? code - 96 : -1);
    if (digit >= 0) {
      pushDigit(digit);
      e.preventDefault();
      return;
    }
    switch (code) {
      case KEY.LEFT: ui.zone === "controls" ? moveControlFocus(-1) : moveFocus(-1, 0); break;
      case KEY.RIGHT: ui.zone === "controls" ? moveControlFocus(1) : moveFocus(1, 0); break;
      case KEY.UP: moveFocus(0, -1); break;
      case KEY.DOWN: moveFocus(0, 1); break;
      case KEY.ENTER:
        if (ui.numberBuffer) { commitNumberEntry(); } else { activateFocused(); }
        break;
      case KEY.PLAY: if (player.state !== "playing") { togglePlayback(); } break;
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

  function registerTvKeys() {
    if (typeof tizen === "undefined" || !tizen.tvinputdevice) { return; }
    try {
      tizen.tvinputdevice.registerKeyBatch(MEDIA_KEYS);
    } catch (e) {
      for (var i = 0; i < MEDIA_KEYS.length; i++) {
        try { tizen.tvinputdevice.registerKey(MEDIA_KEYS[i]); } catch (ignored) { /* unsupported key */ }
      }
    }
  }

  function setScreenSaver(allowed) {
    try {
      var api = webapis.appcommon;
      api.setScreenSaver(allowed ? api.AppCommonScreenSaverState.SCREEN_SAVER_ON
        : api.AppCommonScreenSaverState.SCREEN_SAVER_OFF);
    } catch (e) { /* not on a Samsung TV */ }
  }

  function onPlayerEvent(type) {
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

  function audioUrl(reciter, surah) {
    var n = String(surah.number);
    while (n.length < 3) { n = "0" + n; }
    return QURAN_AUDIO_BASE + reciter.path + n + ".mp3";
  }

  function indexOfReciter(id) {
    for (var i = 0; i < RECITERS.length; i++) {
      if (RECITERS[i].id === id) { return i; }
    }
    return -1;
  }

  function loadSelection() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { return {}; }
  }

  function saveSelection() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        reciterId: RECITERS[ui.reciterIndex].id,
        surah: SURAHS[ui.surahIndex].number
      }));
    } catch (e) { /* storage unavailable */ }
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var mm = h ? (m < 10 ? "0" : "") + m : String(m);
    return (h ? h + ":" : "") + mm + ":" + (s < 10 ? "0" : "") + s;
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function hasClass(el, c) { return (" " + el.className + " ").indexOf(" " + c + " ") >= 0; }
  function addClass(el, c) { if (!hasClass(el, c)) { el.className = (el.className + " " + c).trim(); } }
  function removeClass(el, c) { el.className = (" " + el.className + " ").replace(" " + c + " ", " ").trim(); }
  function toggleClass(el, c, on) { if (on) { addClass(el, c); } else { removeClass(el, c); } }

  // ---------- Boot ----------

  buildLists();
  registerTvKeys();
  document.addEventListener("keydown", onKeyDown);
  renderClock();
  setInterval(renderClock, 15000);
  render();

  window.QuraanApp = { player: player, ui: ui, audioUrl: audioUrl };
})();
