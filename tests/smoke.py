"""Browser smoke test: drives the app with TV remote key codes via Chrome (CDP)."""
import os, sys, time
from playwright.sync_api import sync_playwright

URL = os.environ.get("APP_URL", "http://localhost:8080/index.html")
CDP = os.environ.get("CDP_URL", "http://localhost:29229")
SHOTS = os.environ.get("SHOTS_DIR", "/tmp/quraan-shots")
os.makedirs(SHOTS, exist_ok=True)

def key(page, code):
    page.evaluate("c => document.dispatchEvent(new KeyboardEvent('keydown', {keyCode: c, which: c, bubbles: true}))", code)
    time.sleep(0.3)

def st(page):
    return page.evaluate("() => ({state: QuraanApp.player.state, loops: QuraanApp.player.loopCount, t: QuraanApp.player.audio.currentTime, src: QuraanApp.player.audio.currentSrc, loop: QuraanApp.player.audio.loop})")

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(CDP)
    ctx = browser.contexts[0]
    page = ctx.new_page()
    page.set_viewport_size({"width": 1920, "height": 1080})
    page.goto(URL)
    page.evaluate("localStorage.clear()")
    page.reload()
    page.screenshot(path=f"{SHOTS}/1-idle.png")

    # Jump to surah 112 with digits, wait for auto-commit
    for c in (49, 49, 50):
        key(page, c)
    page.screenshot(path=f"{SHOTS}/2-number-entry.png")
    time.sleep(2)
    for _ in range(40):
        if st(page)["state"] == "playing": break
        time.sleep(0.5)
    s = st(page); print("after digits", s)
    assert s["state"] == "playing" and s["src"].endswith("/112.mp3") and s["loop"], s

    # Seek near the end and verify it wraps around (loop count increments, still playing)
    page.evaluate("QuraanApp.player.audio.currentTime = QuraanApp.player.audio.duration - 2")
    time.sleep(4.5)
    s = st(page); print("after wrap", s)
    assert s["state"] == "playing" and s["loops"] >= 1 and s["t"] < 10, s
    page.screenshot(path=f"{SHOTS}/3-looping.png")

    # Pause / resume via Play/Pause media key
    key(page, 10252); s = st(page); print("paused", s); assert s["state"] == "paused"
    key(page, 10252); time.sleep(1); s = st(page); print("resumed", s); assert s["state"] == "playing"

    # Next surah via MediaTrackNext keeps looping
    key(page, 10233); time.sleep(3); s = st(page); print("next", s)
    assert s["src"].endswith("/113.mp3") and s["state"] == "playing"

    # Change reciter while playing (Left to reciters, Down, OK)
    key(page, 37); key(page, 40); key(page, 13); time.sleep(3)
    s = st(page); print("reciter", s)
    assert "abdul_basit_murattal/113.mp3" in s["src"] and s["state"] == "playing"
    page.screenshot(path=f"{SHOTS}/4-reciter-changed.png")

    # Back stops playback
    key(page, 10009); s = st(page); print("back", s); assert s["state"] == "stopped"
    page.screenshot(path=f"{SHOTS}/5-stopped.png")

    # Error recovery: a broken URL goes to retrying, not stopped
    page.evaluate("QuraanApp.player.play('http://localhost:8080/missing.mp3')")
    time.sleep(1.5); s = st(page); print("broken src", s); assert s["state"] == "retrying"
    page.evaluate("QuraanApp.player.stop()")
    page.close()
    print("OK")
