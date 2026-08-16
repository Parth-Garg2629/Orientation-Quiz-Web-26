export interface ScoringParams {
  correct: boolean;
  elapsedMs: number;
  timerMs: number;
  points: number;
  timeWindow?: number;
  fullPointsWindow?: boolean;
}

/**
 * Calculates score based on correctness and response time.
 * - If incorrect or unanswered -> 0
 * - If answered within timeWindow (default first 25%) -> full points
 * - If answered after timeWindow up to timer expiry -> linearly decays to 0
 * - Boundary: ratio == timeWindow -> fullPoints
 * - Boundary: ratio >= 1.0 -> 0
 */
export function calculateQuestionScore(params: ScoringParams): number {
  const {
    correct,
    elapsedMs,
    timerMs,
    points,
    timeWindow = 0.25,
    fullPointsWindow = true,
  } = params;

  if (!correct) {
    return 0;
  }

  if (timerMs <= 0 || elapsedMs <= 0) {
    return points;
  }

  const ratio = Math.min(Math.max(elapsedMs / timerMs, 0), 1);

  // Answered within the full points grace window
  if (ratio <= timeWindow) {
    return points;
  }

  // Answered at or beyond expiry
  if (ratio >= 1) {
    return 0;
  }

  // Linear decay between timeWindow and 1.0
  if (fullPointsWindow) {
    const decayFactor = (1 - ratio) / (1 - timeWindow);
    return Math.round(points * decayFactor);
  }

  return Math.round(points * 0.5);
}
