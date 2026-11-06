// Synthetic pose traces for the pad round's detector. These check its logic, not its
// accuracy on real people, which needs testing with a real camera.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PunchDetector, framing, handFor, summarize } from "../site/pad-logic.js";

const WIDTH = 480;
const HEIGHT = 640;
const SHOULDERS = 120;

// A person in guard, facing an unmirrored camera, so their left side appears on the image's right.
function guard() {
  const points = Array.from({ length: 17 }, () => ({ x: 0, y: 0, score: 0.1 }));
  const set = (index, x, y, score = 0.8) => (points[index] = { x, y, score });
  set(0, 240, 180);
  set(5, 240 + SHOULDERS / 2, 260);
  set(6, 240 - SHOULDERS / 2, 260);
  set(7, 240 + SHOULDERS * 0.7, 340);
  set(8, 240 - SHOULDERS * 0.7, 340);
  set(9, 240 + SHOULDERS * 0.4, 215);
  set(10, 240 - SHOULDERS * 0.4, 215);
  return points;
}

// Seeded, so any failure can be reproduced.
function jitter(seed) {
  let state = seed;
  return (size) => {
    state = (state * 16807) % 2147483647;
    return ((state / 2147483647) * 2 - 1) * size;
  };
}

function withNoise(points, noise, size) {
  return points.map((point) => ({ ...point, x: point.x + noise(size), y: point.y + noise(size) }));
}

function ease(amount) {
  const clamped = Math.min(1, Math.max(0, amount));
  return clamped * clamped * (3 - 2 * clamped);
}

// wrist and elbow are the keypoints that move. toward is how far, in shoulder widths, at full extension.
function throwing(points, { wrist, elbow, amount, toward = 0.55 }) {
  const out = points.map((point) => ({ ...point }));
  out[wrist].x += (240 - out[wrist].x) * 0.7 * amount;
  out[wrist].y -= SHOULDERS * toward * amount * 0.5;
  out[elbow].y -= SHOULDERS * 0.5 * amount;
  return out;
}

function run({ fps = 20, cueAt = 1000, punchAt = 1300, wrist = 9, elbow = 7, durationMs = 180, seed = 7, noiseSize = 1.5, endAt = 2200, edit }) {
  const detector = new PunchDetector();
  const noise = jitter(seed);
  const found = [];
  for (let t = 0; t <= endAt; t += 1000 / fps) {
    if (t >= cueAt && !detector.armed) assert.ok(detector.arm(cueAt), "should arm from guard frames");
    let points = guard();
    if (punchAt !== null) {
      const amount = t < punchAt ? 0 : ease((t - punchAt) / durationMs);
      const back = t > punchAt + durationMs + 150 ? ease((t - punchAt - durationMs - 150) / 200) : 0;
      if (wrist !== null) points = throwing(points, { wrist, elbow, amount: amount * (1 - back) });
    }
    if (edit) points = edit(points, t);
    detector.push(t, withNoise(points, noise, noiseSize));
    const punch = detector.read();
    if (punch) found.push({ ...punch, seenAt: t });
  }
  return found;
}

for (const fps of [10, 15, 20, 30]) {
  test(`finds a left jab at ${fps} fps and times its start`, () => {
    const found = run({ fps });
    assert.equal(found.length, 1);
    assert.equal(found[0].hand, "left");
    assert.equal(found[0].early, false);
    // The punch starts 300 ms after the cue. Small first movement is hidden by noise, so it reads slightly late.
    assert.ok(found[0].reactionMs >= 300 - 1000 / fps && found[0].reactionMs <= 300 + 1000 / fps + 80, `reaction was ${found[0].reactionMs}`);
  });

  test(`finds a right cross at ${fps} fps`, () => {
    const found = run({ fps, wrist: 10, elbow: 8 });
    assert.equal(found.length, 1);
    assert.equal(found[0].hand, "right");
  });
}

test("holding guard with tracking noise never counts as a punch", () => {
  for (let seed = 1; seed < 40; seed++) {
    assert.deepEqual(run({ seed, punchAt: null, noiseSize: 4, endAt: 5000 }), [], `seed ${seed}`);
  }
});

test("finds punches reliably across noisy runs", () => {
  for (let seed = 1; seed < 40; seed++) {
    const found = run({ seed, noiseSize: 3 });
    assert.equal(found.length, 1, `seed ${seed}`);
    assert.equal(found[0].hand, "left", `seed ${seed}`);
  }
});

test("slowly lowering a hand isn't a punch", () => {
  const found = run({
    punchAt: null,
    edit: (points, t) => {
      const out = points.map((point) => ({ ...point }));
      out[9].y += Math.max(0, t - 1000) * 0.08;
      return out;
    },
  });
  assert.deepEqual(found, []);
});

test("leaning or stepping sideways isn't a punch", () => {
  const found = run({
    punchAt: null,
    edit: (points, t) => points.map((point) => ({ ...point, x: point.x + (Math.max(0, t - 1000) / 1000) * 90 })),
  });
  assert.deepEqual(found, []);
});

test("moving both hands together isn't a punch", () => {
  const found = run({
    wrist: null,
    edit: (points, t) => {
      const amount = ease((t - 1300) / 180);
      return throwing(throwing(points, { wrist: 9, elbow: 7, amount }), { wrist: 10, elbow: 8, amount });
    },
  });
  assert.deepEqual(found, []);
});

test("a wrist that disappears at full extension still counts, through the elbow", () => {
  const found = run({
    edit: (points, t) => {
      if (t < 1360) return points;
      const out = points.map((point) => ({ ...point }));
      out[9].score = 0.05;
      return out;
    },
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].hand, "left");
});

test("a reaction faster than a person can manage is flagged as early", () => {
  const found = run({ fps: 30, punchAt: 1000, durationMs: 120 });
  assert.equal(found.length, 1);
  assert.equal(found[0].early, true);
});

test("swapped left and right labels are corrected", () => {
  const found = run({
    edit: (points) => {
      const out = points.map((point) => ({ ...point }));
      for (const [a, b] of [[5, 6], [7, 8], [9, 10]]) [out[a], out[b]] = [out[b], out[a]];
      return out;
    },
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].hand, "left");
});

test("works the same at a different distance from the camera", () => {
  const found = run({ edit: (points) => points.map((point) => ({ ...point, x: 240 + (point.x - 240) * 0.45, y: 300 + (point.y - 300) * 0.45 })), noiseSize: 1 });
  assert.equal(found.length, 1);
  assert.equal(found[0].hand, "left");
});

test("a wrong-hand punch only fires once until the hands come back", () => {
  const found = run({ wrist: 10, elbow: 8, endAt: 2200 });
  assert.equal(found.length, 1);
});

test("hands return to guard, then settled turns true again", () => {
  const detector = new PunchDetector();
  for (let t = 0; t < 500; t += 50) detector.push(t, guard());
  assert.equal(detector.settled(450), true);
  for (let t = 500; t < 650; t += 50) detector.push(t, throwing(guard(), { wrist: 9, elbow: 7, amount: 1 }));
  assert.equal(detector.settled(600), false);
  for (let t = 650; t < 1200; t += 50) detector.push(t, guard());
  assert.equal(detector.settled(1150), true);
});

test("framing asks for what's missing", () => {
  assert.equal(framing(guard(), WIDTH, HEIGHT).ok, true);

  const none = guard().map((point) => ({ ...point, score: 0 }));
  assert.match(framing(none, WIDTH, HEIGHT).hint, /shoulders/);

  const close = guard();
  close[5].x = 440;
  close[6].x = 40;
  assert.match(framing(close, WIDTH, HEIGHT).hint, /back/);

  const far = guard();
  far[5].x = 260;
  far[6].x = 220;
  assert.match(framing(far, WIDTH, HEIGHT).hint, /closer/);

  const noHand = guard();
  noHand[9].score = 0;
  assert.match(framing(noHand, WIDTH, HEIGHT).hint, /hands/);

  const low = guard();
  low[10].y = 500;
  assert.match(framing(low, WIDTH, HEIGHT).hint, /Hands up/);
});

test("a jab is the lead hand for either stance", () => {
  assert.equal(handFor("jab", "orthodox"), "left");
  assert.equal(handFor("cross", "orthodox"), "right");
  assert.equal(handFor("jab", "southpaw"), "right");
  assert.equal(handFor("cross", "southpaw"), "left");
});

test("summaries only count hits", () => {
  assert.deepEqual(summarize([{ hit: true, reactionMs: 300 }, { hit: false }, { hit: true, reactionMs: 401 }]), { total: 3, hits: 2, averageMs: 351, bestMs: 300 });
  assert.deepEqual(summarize([{ hit: false }]), { total: 1, hits: 0, averageMs: null, bestMs: null });
});
