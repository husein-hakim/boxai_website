// Boxing round timer. Time is worked out from the clock rather than counted in ticks, and
// every bell is booked on the audio clock in advance, because browsers slow down JavaScript
// timers in hidden pages (to once a minute in Chrome) but keep playing booked audio.
(() => {
  const COUNTDOWN = 10;
  const REST_WARNING_MAX = 10;
  const STORE = "box-round-timer";
  const LIMITS = {
    rounds: { min: 1, max: 30, step: 1 },
    round: { min: 30, max: 600, step: 30 },
    rest: { min: 0, max: 300, step: 15 },
  };

  const $ = (id) => document.getElementById(id);
  const live = $("timer-live");
  const clock = $("live-clock");
  const pageTitle = document.title;

  const settings = { rounds: 3, round: 180, rest: 60, warn: 10 };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    for (const key of Object.keys(settings)) {
      const limit = LIMITS[key];
      const value = saved?.[key];
      if (Number.isInteger(value) && (limit ? value >= limit.min && value <= limit.max : [0, 10, 30].includes(value))) settings[key] = value;
    }
  } catch {
    /* Private browsing or a bad saved value: use the defaults. */
  }

  const time = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  // Settings screen
  function renderSettings() {
    for (const stepper of document.querySelectorAll(".stepper")) {
      const key = stepper.dataset.field;
      const value = settings[key];
      stepper.querySelector("output").textContent = key === "rounds" ? value : time(value);
      stepper.querySelector("[data-step='-1']").disabled = value <= LIMITS[key].min;
      stepper.querySelector("[data-step='1']").disabled = value >= LIMITS[key].max;
    }
    for (const button of document.querySelectorAll("[data-preset]")) {
      const [rounds, round, rest] = button.dataset.preset.split(",").map(Number);
      button.setAttribute("aria-pressed", rounds === settings.rounds && round === settings.round && rest === settings.rest);
    }
    for (const button of document.querySelectorAll("[data-warn]")) {
      button.setAttribute("aria-pressed", Number(button.dataset.warn) === settings.warn);
    }
    const seconds = settings.rounds * settings.round + (settings.rounds - 1) * settings.rest;
    $("timer-total").textContent = `Total ${time(seconds)}, plus a ${COUNTDOWN}s countdown`;
    try {
      localStorage.setItem(STORE, JSON.stringify(settings));
    } catch {
      /* Settings just won't be remembered. */
    }
  }

  document.querySelector(".timer").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.step) {
      const key = button.closest(".stepper").dataset.field;
      const { min, max, step } = LIMITS[key];
      settings[key] = Math.min(max, Math.max(min, settings[key] + Number(button.dataset.step) * step));
    } else if (button.dataset.preset) {
      [settings.rounds, settings.round, settings.rest] = button.dataset.preset.split(",").map(Number);
    } else if (button.dataset.warn) {
      settings.warn = Number(button.dataset.warn);
    } else {
      return;
    }
    renderSettings();
  });

  // Sound. Bells are drawn once into buffers, so a long session needs only one audio node per sound.
  const BELL = [[1, 1, 1.6], [1.51, 0.7, 1.2], [2.24, 0.55, 0.9], [2.92, 0.4, 0.7], [4.16, 0.25, 0.4], [5.43, 0.15, 0.25]];
  const CLACK = [[1, 1, 0.03], [1.48, 0.7, 0.02], [2.6, 0.3, 0.012]];
  let audio = null;
  let sounds = null;
  let booked = [];
  let audioOffset = 0;

  function draw(partials, pitch, strikes, seconds) {
    const rate = audio.sampleRate;
    const data = new Float32Array(Math.ceil(seconds * rate));
    for (const start of strikes) {
      const first = Math.floor(start * rate);
      for (let i = first; i < data.length; i++) {
        const t = (i - first) / rate;
        const attack = Math.min(1, t / 0.002);
        for (const [ratio, level, decay] of partials) {
          data[i] += attack * level * Math.exp(-t / decay) * Math.sin(2 * Math.PI * pitch * ratio * t);
        }
      }
    }
    const peak = data.reduce((max, value) => Math.max(max, Math.abs(value)), 0.001);
    const buffer = audio.createBuffer(1, data.length, rate);
    buffer.getChannelData(0).set(data.map((value) => (value / peak) * 0.95));
    return buffer;
  }

  function prepareAudio() {
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context) return Promise.resolve();
    if (!audio) {
      audio = new Context();
      sounds = {
        start: draw(BELL, 880, [0], 3),
        end: draw(BELL, 880, [0, 0.38, 0.76], 4),
        warn: draw(CLACK, 1500, [0, 0.2, 0.4], 0.8),
      };
    }
    return audio.resume().catch(() => {});
  }

  function play(sound, when) {
    const source = audio.createBufferSource();
    source.buffer = sounds[sound];
    source.connect(audio.destination);
    source.start(when);
    return source;
  }

  function cancelBells() {
    for (const source of booked) {
      try {
        source.stop();
      } catch {
        /* Already finished. */
      }
    }
    booked = [];
  }

  function bookBells() {
    cancelBells();
    if (!session || session.startedAt === null || audio?.state !== "running") return;
    const now = elapsed();
    audioOffset = audio.currentTime - now;
    for (const cue of session.cues) {
      if (cue.at > now - 0.05) booked.push(play(cue.sound, Math.max(audio.currentTime, cue.at + audioOffset)));
    }
    session.bellsBooked = true;
  }

  // Keeps the bells lined up if the browser paused audio while the page was hidden.
  function checkBells() {
    if (!audio || session?.startedAt === null) return;
    session.soundOff = audio.state !== "running" && (session.bellsBooked || elapsed() > 2); // Sound takes a moment to start.
    if (audio.state !== "running") {
      audio.resume().catch(() => {});
      return;
    }
    if (!session.bellsBooked) return bookBells();
    if (Math.abs(audio.currentTime - audioOffset - elapsed()) > 0.3) {
      session.bellsMissed = true;
      bookBells();
    }
  }

  // Screen wake lock
  let lock = null;
  let awake = "pending";

  async function keepAwake() {
    if (lock) return;
    if (!("wakeLock" in navigator)) {
      awake = "no";
      return;
    }
    try {
      const granted = await navigator.wakeLock.request("screen");
      if (!session) return void granted.release();
      lock = granted;
      awake = "yes";
      granted.addEventListener("release", () => {
        lock = null;
      });
    } catch {
      awake = "no";
    }
  }

  function letSleep() {
    lock?.release();
    lock = null;
    awake = "pending";
  }

  // Session
  let session = null;
  let ticker = null;

  function plan({ rounds, round, rest, warn }) {
    const parts = [{ type: "ready", at: 0, length: COUNTDOWN }];
    const cues = [];
    let at = COUNTDOWN;
    for (let number = 1; number <= rounds; number++) {
      const prior = parts[parts.length - 1];
      parts.push({ type: "round", number, at, length: round });
      if (prior.type !== "round") cues.push({ at, sound: "start" });
      if (warn && warn < round) cues.push({ at: at + round - warn, sound: "warn" });
      at += round;
      cues.push({ at, sound: "end" });
      if (rest && number < rounds) {
        const restWarn = Math.min(warn, REST_WARNING_MAX);
        parts.push({ type: "rest", number, at, length: rest });
        if (restWarn && restWarn < rest) cues.push({ at: at + rest - restWarn, sound: "warn" });
        at += rest;
      }
    }
    return { parts, cues, total: at };
  }

  function elapsed() {
    return session.banked + (session.startedAt === null ? 0 : (Date.now() - session.startedAt) / 1000);
  }

  function partAt(seconds) {
    return session.parts.findLast((part) => part.at <= seconds) ?? session.parts[0];
  }

  function labels(part) {
    const { rounds, rest } = session.settings;
    if (part.type === "ready") return ["Get ready", `Next: round 1 of ${rounds}`];
    if (part.type === "rest") return ["Rest", `Next: round ${part.number + 1} of ${rounds}`];
    if (part.number === rounds) return [`Round ${part.number} of ${rounds}`, "Last round"];
    return [`Round ${part.number} of ${rounds}`, rest ? `Next: rest ${time(rest)}` : `Next: round ${part.number + 1}`];
  }

  function statusText() {
    if (session.startedAt !== null && session.soundOff) return "Your browser paused the sound. Tap the screen to restart it. The clock kept running.";
    if (session.startedAt !== null && session.bellsMissed) return "You may have missed a bell while this page was hidden. The clock kept running.";
    if (awake === "no") return "Your screen may sleep. Turn off auto-lock for this session.";
    if (awake === "yes") return "Screen stays on during your session.";
    return "";
  }

  function render() {
    const now = Math.min(elapsed(), session.total);
    const part = partAt(now);
    const left = Math.max(0, Math.ceil(part.at + part.length - now));
    const paused = session.startedAt === null;
    const warning = part.type === "round" && session.settings.warn > 0 && session.settings.warn < part.length && left <= session.settings.warn;
    const [phase, next] = labels(part);

    live.dataset.state = paused ? "paused" : warning ? "warning" : part.type;
    clock.textContent = time(left);
    clock.classList.toggle("is-long", left >= 600);
    $("live-phase").textContent = paused ? `Paused: ${phase}` : warning ? `${phase}: last ${session.settings.warn}s` : phase;
    $("live-next").textContent = next;
    $("live-bar").style.transform = `scaleX(${Math.min(1, (now - part.at) / part.length)})`;
    $("live-status").textContent = statusText();
    document.title = `${time(left)} ${phase} | Box AI`;

    if (session.announced !== part) {
      session.announced = part;
      session.bellsMissed = false;
      $("live-announce").textContent = `${phase}, ${time(part.length)}`;
    }
  }

  function tick() {
    if (!session || session.startedAt === null) return;
    if (elapsed() >= session.total) return finish();
    checkBells();
    render();
  }

  function setRunning(running) {
    $("live-main").textContent = running ? "Pause" : "Resume";
    $("live-minor").hidden = running;
  }

  function start() {
    prepareAudio().then(() => {
      if (session) checkBells();
    });
    session = {
      ...plan(settings),
      settings: { ...settings },
      banked: 0,
      startedAt: Date.now(),
      bellsBooked: false,
      soundOff: false,
      bellsMissed: false,
      announced: null,
    };
    setRunning(true);
    live.classList.remove("is-done");
    $("live-skip").hidden = false;
    $("live-end").textContent = "End session";
    $("live-bar").parentElement.hidden = false;
    if (!live.open) live.showModal();
    $("live-main").focus({ focusVisible: false });
    keepAwake();
    clearInterval(ticker);
    ticker = setInterval(tick, 200);
    render();
    document.dispatchEvent(new CustomEvent("timer:started", {
      detail: { rounds: settings.rounds, round_seconds: settings.round, rest_seconds: settings.rest, warning_seconds: settings.warn },
    }));
  }

  function pause() {
    session.banked = elapsed();
    session.startedAt = null;
    cancelBells();
    setRunning(false);
    render();
  }

  function resume() {
    session.startedAt = Date.now();
    session.bellsBooked = false;
    setRunning(true);
    prepareAudio().then(() => {
      if (session) checkBells();
    });
    keepAwake();
    render();
  }

  function skip() {
    const part = partAt(session.banked);
    session.banked = part.at + part.length;
    if (session.banked >= session.total) return finish();
    render();
  }

  function finish() {
    const { rounds, round } = session.settings;
    clearInterval(ticker);
    booked = []; // Let the last bell ring out.
    session = null;
    letSleep();
    document.title = pageTitle;
    live.dataset.state = "done";
    live.classList.add("is-done");
    clock.textContent = "Done";
    $("live-phase").textContent = `${rounds} ${rounds === 1 ? "round" : "rounds"} of ${time(round)}`;
    $("live-next").textContent = "Good work.";
    $("live-bar").parentElement.hidden = true;
    $("live-announce").textContent = "Session finished.";
    $("live-status").textContent = "";
    $("live-main").textContent = "Go again";
    $("live-minor").hidden = false;
    $("live-skip").hidden = true;
    $("live-end").textContent = "Close";
  }

  function close() {
    const wasDone = live.classList.contains("is-done");
    clearInterval(ticker);
    cancelBells();
    session = null;
    letSleep();
    document.title = pageTitle;
    live.close();
    $("timer-start").focus({ preventScroll: wasDone });
    if (wasDone) document.querySelector(".cta").scrollIntoView({ block: "center", behavior: "instant" });
  }

  $("timer-start").addEventListener("click", start);

  $("timer-test").addEventListener("click", async () => {
    await prepareAudio();
    if (audio?.state === "running") play("start", audio.currentTime);
  });

  $("live-main").addEventListener("click", () => {
    if (!session) return start();
    session.startedAt === null ? resume() : pause();
  });
  $("live-skip").addEventListener("click", skip);
  $("live-end").addEventListener("click", close);

  // Esc pauses rather than ending the session, and closes the finished screen.
  live.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!session) close();
    else if (session.startedAt !== null) pause();
  });

  // A tap is also the browser's permission to restart sound it paused.
  live.addEventListener("pointerdown", () => audio?.resume().catch(() => {}));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !session) return;
    keepAwake();
    audio?.resume().catch(() => {});
    tick();
  });

  renderSettings();
})();
