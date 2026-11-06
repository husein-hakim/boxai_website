// Punch detection for the website's pad round. It only sees pose keypoints, as
// { x, y, score } in camera pixels, in MoveNet's order. The camera image isn't mirrored.
//
// A punch thrown at the camera barely moves in 2D, so the checks are forgiving: a missed
// punch hurts a demo more than a generous one does. Everything is measured in shoulder
// widths, so it works at any distance from the camera.

const LEFT = { elbow: 7, wrist: 9 };
const RIGHT = { elbow: 8, wrist: 10 };
const LEFT_SHOULDER = 5;
const RIGHT_SHOULDER = 6;
const SHOULDER_SEEN = 0.3;
const LIMB_SEEN = 0.2;

const SMOOTHING = 0.65; // Weight of the newest frame
const HISTORY_MS = 1500;
const SETTLE_MS = 350;
const SETTLE_RANGE = 0.22; // Hands count as still if they stay within this range
const TRIGGER = 0.34; // Arm movement that counts as a punch
const MIN_RATE = 0.9; // Shoulder widths per second, so slowly lowering a hand doesn't count
const RATE_WINDOW_MS = 220;
const DOMINANCE = 0.8; // The other arm must have moved less than this share
const ONSET = 0.1;
const REARM = 0.2;
const MIN_REACTION_MS = 100; // Faster than a person can react, so they moved early

const seen = (point, minimum = LIMB_SEEN) => point && point.score >= minimum;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const handFor = (punch, stance) => ((punch === "jab") === (stance === "orthodox") ? "left" : "right");

// Whether the person is placed so a round can start, and what to tell them if not.
export function framing(points, width, height) {
  const [leftShoulder, rightShoulder] = [points[LEFT_SHOULDER], points[RIGHT_SHOULDER]];
  if (!seen(leftShoulder, SHOULDER_SEEN) || !seen(rightShoulder, SHOULDER_SEEN)) return { ok: false, hint: "Get your head and shoulders in view" };
  const shoulders = distance(leftShoulder, rightShoulder);
  const size = shoulders / Math.min(width, height);
  if (size > 0.6) return { ok: false, hint: "Step back a little" };
  if (size < 0.1) return { ok: false, hint: "Come a little closer" };
  if (!seen(points[LEFT.wrist]) || !seen(points[RIGHT.wrist])) return { ok: false, hint: "Bring both hands into view" };
  const guardLine = (leftShoulder.y + rightShoulder.y) / 2 + shoulders * 0.9;
  if (points[LEFT.wrist].y > guardLine || points[RIGHT.wrist].y > guardLine) return { ok: false, hint: "Hands up, by your chin" };
  return { ok: true, hint: "Hold your guard" };
}

export class PunchDetector {
  frames = [];
  armed = null;
  smoothed = new Map();

  #smooth(points, index, minimum = LIMB_SEEN) {
    const point = points[index];
    const last = this.smoothed.get(index);
    if (!seen(point, minimum)) return last ? { ...last, seen: false } : null;
    const next = last
      ? { x: last.x + (point.x - last.x) * SMOOTHING, y: last.y + (point.y - last.y) * SMOOTHING, seen: true }
      : { x: point.x, y: point.y, seen: true };
    this.smoothed.set(index, next);
    return next;
  }

  push(t, points) {
    const leftShoulder = this.#smooth(points, LEFT_SHOULDER, SHOULDER_SEEN);
    const rightShoulder = this.#smooth(points, RIGHT_SHOULDER, SHOULDER_SEEN);
    const arm = ({ elbow, wrist }) => ({ elbow: this.#smooth(points, elbow), wrist: this.#smooth(points, wrist) });
    const left = arm(LEFT);
    const right = arm(RIGHT);
    const whole = leftShoulder?.seen && rightShoulder?.seen && left.wrist && right.wrist;
    this.frames.push(whole
      ? { t, leftShoulder, rightShoulder, origin: { x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2 }, width: distance(leftShoulder, rightShoulder), left, right }
      : { t, lost: true });
    while (this.frames.length && t - this.frames[0].t > HISTORY_MS) this.frames.shift();
  }

  // Both hands visible and still, which is when the next punch can be called.
  settled(t) {
    const recent = this.frames.filter((frame) => t - frame.t <= SETTLE_MS);
    if (recent.length < 2 || recent.some((frame) => frame.lost || !frame.left.wrist.seen || !frame.right.wrist.seen)) return false;
    const width = recent[0].width;
    return ["left", "right"].every((side) => {
      const xs = recent.map((frame) => (frame[side].wrist.x - frame.origin.x) / width);
      const ys = recent.map((frame) => (frame[side].wrist.y - frame.origin.y) / width);
      return Math.max(...xs) - Math.min(...xs) < SETTLE_RANGE && Math.max(...ys) - Math.min(...ys) < SETTLE_RANGE;
    });
  }

  // Records the guard position just before a cue. Each cue gets a fresh one, so hands can drift between punches.
  arm(cueTime) {
    const recent = this.frames.filter((frame) => !frame.lost && cueTime - frame.t <= SETTLE_MS && frame.t <= cueTime);
    if (!recent.length) return false;
    const mean = (read) => recent.reduce((sum, frame) => sum + read(frame), 0) / recent.length;
    const width = mean((frame) => frame.width);
    const pose = (side, part) => {
      const known = recent.map((frame) => frame[side][part]).filter(Boolean);
      if (!known.length) return null;
      return {
        x: known.reduce((sum, point) => sum + point.x, 0) / known.length,
        y: known.reduce((sum, point) => sum + point.y, 0) / known.length,
      };
    };
    const originX = mean((frame) => frame.origin.x);
    const originY = mean((frame) => frame.origin.y);
    const relative = (point) => point && { x: point.x - originX, y: point.y - originY };
    this.armed = {
      cueTime,
      width,
      cooling: false,
      // In an unmirrored front view the left shoulder appears on the right. If it doesn't, the labels are swapped.
      swapped: mean((frame) => frame.leftShoulder.x) < mean((frame) => frame.rightShoulder.x),
      left: { wrist: relative(pose("left", "wrist")), elbow: relative(pose("left", "elbow")) },
      right: { wrist: relative(pose("right", "wrist")), elbow: relative(pose("right", "elbow")) },
    };
    return true;
  }

  disarm() {
    this.armed = null;
  }

  #score(frame, side) {
    const guard = this.armed[side];
    const moved = (point, base) => (point && base ? Math.hypot(point.x - frame.origin.x - base.x, point.y - frame.origin.y - base.y) / this.armed.width : 0);
    const { wrist, elbow } = frame[side];
    const elbowMoved = elbow?.seen ? moved(elbow, guard.elbow) : 0;
    // The wrist often drops out at full extension toward the camera, so the elbow stands in for it.
    return wrist.seen ? moved(wrist, guard.wrist) + elbowMoved * 0.5 : elbowMoved * 1.5;
  }

  // Returns a punch once one is seen. Call after each push.
  read() {
    const { armed, frames } = this;
    const now = frames.at(-1);
    if (!armed || !now || now.lost || now.t < armed.cueTime) return null;
    const scores = { left: this.#score(now, "left"), right: this.#score(now, "right") };
    if (armed.cooling) {
      if (scores.left < REARM && scores.right < REARM) armed.cooling = false;
      return null;
    }
    const side = scores.left >= scores.right ? "left" : "right";
    const other = side === "left" ? "right" : "left";
    if (scores[side] < TRIGGER || scores[other] > scores[side] * DOMINANCE) return null;

    const live = frames.filter((frame) => !frame.lost);
    const before = live.find((frame) => now.t - frame.t <= RATE_WINDOW_MS);
    if (!before || before === now) return null;
    if ((scores[side] - this.#score(before, side)) / ((now.t - before.t) / 1000) < MIN_RATE) return null;

    let onset = now.t;
    for (let index = live.length - 1; index >= 0 && this.#score(live[index], side) > ONSET; index--) onset = live[index].t;
    const reactionMs = onset - armed.cueTime;
    armed.cooling = true;
    const hand = armed.swapped ? other : side;
    return { hand, reactionMs: Math.max(0, Math.round(reactionMs)), early: reactionMs < MIN_REACTION_MS };
  }
}

export function summarize(attempts) {
  const times = attempts.filter((attempt) => attempt.hit).map((attempt) => attempt.reactionMs);
  return {
    total: attempts.length,
    hits: times.length,
    averageMs: times.length ? Math.round(times.reduce((sum, time) => sum + time, 0) / times.length) : null,
    bestMs: times.length ? Math.min(...times) : null,
  };
}
