// The pad round: runs MoveNet on the camera feed, on the device, and times reactions.
// This file loads when the overlay opens, and the runtime and model after someone taps
// Start. No frames or keypoints leave the browser.
import { PunchDetector, framing, handFor, summarize } from "/pad-logic.js";

const CUES = ["jab", "cross", "jab", "jab", "cross", "jab"];
const INPUT_SIZE = 192;
const FRAMED_MS = 800;
const MIN_WAIT_MS = 900;
const EXTRA_WAIT_MS = 700;
const CUE_MS = 3500;
const FEEDBACK_MS = 750;
const NOT_SETTLED_MS = 12000; // Ends the round if the hands never come back into view
const SKELETON = [[5, 6], [5, 7], [7, 9], [6, 8], [8, 10]];

let estimator = null;

async function fetchBytes(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Model request failed: ${response.status}`);
  const total = Number(response.headers.get("Content-Length")) || 4758512;
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(0.99, received / total));
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function loadEstimator(onProgress) {
  estimator ??= (async () => {
    const { loadLiteRt, loadAndCompile, Tensor } = await import("/assets/pose/litert.js");
    const [, bytes] = await Promise.all([loadLiteRt("/assets/pose/wasm/"), fetchBytes("/assets/pose/movenet_lightning_fp16.tflite", onProgress)]);
    const model = await loadAndCompile(bytes, { accelerator: "wasm" });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = INPUT_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const rgb = new Uint8Array(INPUT_SIZE * INPUT_SIZE * 3);

    // Letterboxes the whole frame, so a newly extended arm can't fall outside the model's view.
    return async (source, width, height) => {
      const scale = INPUT_SIZE / Math.max(width, height);
      const [drawWidth, drawHeight] = [width * scale, height * scale];
      const [left, top] = [(INPUT_SIZE - drawWidth) / 2, (INPUT_SIZE - drawHeight) / 2];
      context.fillStyle = "#000";
      context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
      context.drawImage(source, left, top, drawWidth, drawHeight);
      const { data } = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
      for (let from = 0, to = 0; from < data.length; from += 4, to += 3) {
        rgb[to] = data[from];
        rgb[to + 1] = data[from + 1];
        rgb[to + 2] = data[from + 2];
      }
      const input = new Tensor(rgb, [1, INPUT_SIZE, INPUT_SIZE, 3]);
      const outputs = await model.run(input);
      input.delete();
      const values = outputs[0].toTypedArray();
      const points = [];
      for (let index = 0; index < 17; index++) {
        points.push({
          y: (values[index * 3] * INPUT_SIZE - top) / scale,
          x: (values[index * 3 + 1] * INPUT_SIZE - left) / scale,
          score: values[index * 3 + 2],
        });
      }
      for (const output of outputs) output.delete();
      return points;
    };
  })().catch((error) => {
    estimator = null;
    throw error;
  });
  return estimator;
}

export function createPadRound(dialog, { track, estimate = loadEstimator }) {
  const find = (selector) => dialog.querySelector(selector);
  const video = find("video");
  const canvas = find("canvas");
  const drawing = canvas.getContext("2d");
  const status = find(".pad-status");
  const word = find(".pad-word");
  const hand = find(".pad-hand");
  const target = find(".pad-target");
  const hit = find(".pad-hit");
  const dots = [...dialog.querySelectorAll(".pad-dots i")];
  const panelTitle = find(".pad-result-title");
  const panelBody = find(".pad-result-body");
  const panelStats = find(".pad-stats");

  let session = 0;
  let stream = null;
  let frameHandle = null;
  let audio = null;
  let stance = "orthodox";

  const setState = (state) => (dialog.dataset.state = state);
  const setStatus = (message) => (status.textContent = message);

  function say(text) {
    try {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.25;
      speechSynthesis.speak(utterance);
    } catch {
      /* The cue is still on screen. */
    }
  }

  function thud() {
    if (!audio) return;
    try {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.setValueAtTime(190, audio.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(70, audio.currentTime + 0.1);
      gain.gain.setValueAtTime(0.5, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.14);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.15);
    } catch {
      /* Sound is optional. */
    }
  }

  function stopCamera() {
    if (frameHandle !== null) {
      if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameHandle);
      else cancelAnimationFrame(frameHandle);
      frameHandle = null;
    }
    stream?.getTracks().forEach((mediaTrack) => mediaTrack.stop());
    stream = null;
    video.srcObject = null;
    drawing.clearRect(0, 0, canvas.width, canvas.height);
    try {
      speechSynthesis.cancel();
    } catch {
      /* Nothing was playing. */
    }
  }

  function drawSkeleton(points, width, height) {
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(box.width * ratio)) canvas.width = Math.round(box.width * ratio);
    if (canvas.height !== Math.round(box.height * ratio)) canvas.height = Math.round(box.height * ratio);
    drawing.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawing.clearRect(0, 0, box.width, box.height);
    const fit = getComputedStyle(video).objectFit === "contain" ? Math.min : Math.max;
    const scale = fit(box.width / width, box.height / height);
    const [offsetX, offsetY] = [(box.width - width * scale) / 2, (box.height - height * scale) / 2];
    const place = (point) => [box.width - (point.x * scale + offsetX), point.y * scale + offsetY]; // The preview is mirrored
    drawing.lineWidth = 3;
    drawing.lineCap = "round";
    drawing.strokeStyle = "rgba(246, 243, 238, 0.75)";
    for (const [from, to] of SKELETON) {
      if (points[from].score < 0.2 || points[to].score < 0.2) continue;
      drawing.beginPath();
      drawing.moveTo(...place(points[from]));
      drawing.lineTo(...place(points[to]));
      drawing.stroke();
    }
    drawing.fillStyle = "#3dd68c";
    for (const index of [9, 10]) {
      if (points[index].score < 0.2) continue;
      drawing.beginPath();
      drawing.arc(...place(points[index]), 8, 0, Math.PI * 2);
      drawing.fill();
    }
  }

  function showCue(punch, side) {
    word.textContent = punch;
    hand.textContent = side === "left" ? "Left hand" : "Right hand";
    // The preview is mirrored, so your left hand is on the left of the screen.
    target.dataset.side = side;
    dialog.dataset.cue = "on";
  }

  function hideCue() {
    dialog.dataset.cue = "off";
  }

  function showFeedback(kind, title, detail, combo) {
    hit.dataset.kind = kind;
    hit.querySelector("b").textContent = title;
    hit.querySelector("span").textContent = detail;
    hit.querySelector("em").textContent = combo > 1 ? `COMBO ×${combo}` : "";
    hit.hidden = false;
    hit.classList.remove("pop");
    void hit.offsetWidth;
    hit.classList.add("pop");
  }

  function showResults(attempts, fps) {
    const result = summarize(attempts);
    panelStats.hidden = result.hits === 0;
    if (result.hits) {
      panelStats.querySelector("[data-stat=average]").textContent = `${result.averageMs} ms`;
      panelStats.querySelector("[data-stat=best]").textContent = `${result.bestMs} ms`;
      panelStats.querySelector("[data-stat=hits]").textContent = `${result.hits}/${result.total}`;
      panelTitle.textContent = "Round done";
      panelBody.textContent = "That's Live Pads. The full app also grades your rounds and gives you the drill for what to fix.";
    } else {
      panelTitle.textContent = "We couldn't see your punches";
      panelBody.textContent = "Good light helps, and so does keeping your head, shoulders and both hands in view. The app also grades your rounds and gives you the drill for what to fix.";
    }
    find(".pad-again").textContent = "Go again";
    setState("results");
    track("demo_completed", { hits: result.hits, total: result.total, average_ms: result.averageMs, best_ms: result.bestMs, fps: Math.round(fps), stance });
  }

  function showBlocked(title, body, reason) {
    stopCamera();
    panelStats.hidden = true;
    panelTitle.textContent = title;
    panelBody.textContent = body;
    find(".pad-again").textContent = "Try again";
    setState("blocked");
    track("demo_failed", { reason });
  }

  // Runs one frame at a time. A slow phone drops camera frames instead of falling behind them.
  function eachFrame(run, mine) {
    const useVideoCallback = Boolean(video.requestVideoFrameCallback);
    const next = () => {
      frameHandle = useVideoCallback ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    };
    let lastTime = -1;
    const tick = async (now, metadata) => {
      if (mine !== session) return;
      if (useVideoCallback || video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        const captured = metadata?.captureTime;
        try {
          await run(typeof captured === "number" && Math.abs(now - captured) < 500 ? captured : performance.now());
        } catch (error) {
          console.error(error);
          if (mine === session) {
            session++;
            showBlocked("This device couldn't run the demo", "You can still join the waitlist below.", "run_failed");
          }
          return;
        }
      }
      if (mine === session) next();
    };
    next();
  }

  function play(estimateFrame, mine) {
    const detector = new PunchDetector();
    const attempts = [];
    let phase = "framing";
    let framedSince = null;
    let cueIndex = 0;
    let waitUntil = 0;
    let settleDeadline = 0;
    let cueShownAt = 0;
    let combo = 0;
    let frames = 0;
    let firstFrameAt = null;
    let currentHand = "left";
    let currentPunch = "jab";
    let timeouts = 0;

    const fps = () => (firstFrameAt === null || performance.now() <= firstFrameAt ? 0 : (frames * 1000) / (performance.now() - firstFrameAt));

    const finish = (now) => {
      phase = "done";
      session++;
      hideCue();
      hit.hidden = true;
      stopCamera();
      showResults(attempts, fps(now));
    };

    const record = (attempt, now) => {
      attempts.push(attempt);
      dots[attempts.length - 1].dataset.result = attempt.hit ? "hit" : "miss";
      detector.disarm();
      hideCue();
      cueIndex++;
      phase = "feedback";
      waitUntil = now + FEEDBACK_MS;
    };

    eachFrame(async (now) => {
      const [width, height] = [video.videoWidth, video.videoHeight];
      if (!width || !height) return;
      const points = await estimateFrame(video, width, height);
      if (mine !== session) return;
      firstFrameAt ??= performance.now();
      frames++;
      detector.push(now, points);
      drawSkeleton(points, width, height);

      if (phase === "framing") {
        const { ok, hint } = framing(points, width, height);
        setStatus(hint);
        framedSince = ok ? framedSince ?? now : null;
        if (framedSince !== null && now - framedSince >= FRAMED_MS) {
          setState("round");
          track("demo_started", { fps: Math.round(fps()), stance });
          say("Ready");
          setStatus("Ready");
          phase = "wait";
          waitUntil = now + MIN_WAIT_MS;
          settleDeadline = now + NOT_SETTLED_MS;
        }
        return;
      }

      if (phase === "feedback") {
        if (now < waitUntil) return;
        hit.hidden = true;
        if (cueIndex >= CUES.length) return finish(now);
        setStatus("Back to guard");
        phase = "wait";
        waitUntil = now + MIN_WAIT_MS + Math.random() * EXTRA_WAIT_MS;
        settleDeadline = now + NOT_SETTLED_MS;
        return;
      }

      if (phase === "wait") {
        if (now >= settleDeadline) return finish(now);
        const settled = detector.settled(now);
        if (now < waitUntil) return;
        if (!settled) return setStatus("Hands up, both in view");
        currentPunch = CUES[cueIndex];
        currentHand = handFor(currentPunch, stance);
        setStatus("");
        showCue(currentPunch, currentHand);
        say(currentPunch);
        cueShownAt = performance.now();
        // Starts the clock from when the cue is on screen, not when it was requested.
        requestAnimationFrame(() => {
          if (mine === session && phase === "cue") cueShownAt = performance.now();
        });
        detector.arm(now);
        phase = "cue";
        return;
      }

      if (phase === "cue") {
        const punch = detector.read();
        if (punch) {
          const reactionMs = Math.round(punch.reactionMs - Math.max(0, cueShownAt - detector.armed.cueTime));
          if (punch.early || reactionMs < 100) {
            combo = 0;
            showFeedback("miss", "EARLY", "Wait for the call", 0);
            return record({ hit: false, reason: "early" }, now);
          }
          if (punch.hand !== currentHand) {
            showFeedback("miss", "OTHER HAND", `Use your ${currentHand} hand`, 0);
            return;
          }
          combo++;
          thud();
          const name = currentPunch === "jab" ? "Jab" : "Cross";
          showFeedback("hit", "HIT", `${reactionMs} ms · ${name} recognized`, combo);
          return record({ hit: true, reactionMs }, now);
        }
        if (now - detector.armed.cueTime >= CUE_MS) {
          combo = 0;
          timeouts++;
          showFeedback("miss", "NO PUNCH SEEN", timeouts >= 2 ? "Step back so your whole arm shows" : "Reach out toward the camera", 0);
          record({ hit: false, reason: "timeout" }, now);
        }
      }
    }, mine);
  }

  async function start() {
    const mine = ++session;
    setState("starting");
    dialog.dataset.cue = "off";
    hit.hidden = true;
    dots.forEach((dot) => delete dot.dataset.result);
    stance = find(".pad-southpaw input").checked ? "southpaw" : "orthodox";
    setStatus("Allow your camera to start");

    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      audio.resume();
    } catch {
      /* Sound is optional. */
    }
    say(" "); // Browsers only allow speech that begins with a tap

    if (!navigator.mediaDevices?.getUserMedia) {
      track("demo_camera", { result: "unavailable" });
      return showBlocked(
        "This browser can't use your camera",
        "In-app browsers often block it. Open this page in Safari or Chrome to try the round, or join the waitlist below.",
        "no_camera_api",
      );
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } });
    } catch (error) {
      if (mine !== session) return;
      const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      track("demo_camera", { result: denied ? "blocked" : "failed", error: error?.name });
      return showBlocked(
        denied ? "Camera access was blocked" : "We couldn't start your camera",
        denied
          ? "Allow the camera and try again. In-app browsers can block it, so if that doesn't work, open this page in Safari or Chrome."
          : "Another app might be using it. You can try again, or join the waitlist below.",
        denied ? "camera_blocked" : "camera_failed",
      );
    }
    if (mine !== session) {
      stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
      return;
    }
    track("demo_camera", { result: "allowed" });

    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      /* Autoplay can reject for muted inline video on old browsers. The first frames will still say so below. */
    }
    if (mine !== session) return;
    setState("camera");
    setStatus("Loading the coach…");

    let estimateFrame;
    try {
      estimateFrame = await estimate((progress) => {
        if (mine === session) setStatus(`Loading the coach… ${Math.round(progress * 100)}%`);
      });
    } catch (error) {
      if (mine !== session) return;
      console.error(error);
      return showBlocked("This device couldn't load the demo", "You can still join the waitlist below.", "model_failed");
    }
    if (mine !== session) return;

    setStatus("Step back so your head, shoulders and hands show");
    play(estimateFrame, mine);
  }

  function stop() {
    session++;
    stopCamera();
    dialog.dataset.cue = "off";
    hit.hidden = true;
    setState("intro");
  }

  return { start, stop };
}
