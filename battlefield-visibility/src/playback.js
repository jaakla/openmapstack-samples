export function autoplayAllowed(defaults, reducedMotion) {
  return defaults.playing && !reducedMotion;
}

export function advanceTime(time, elapsedSeconds, { playing, hidden, speed }) {
  return playing && !hidden
    ? time + Math.max(0, Math.min(elapsedSeconds, 0.2)) * speed
    : time;
}
