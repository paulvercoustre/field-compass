/**
 * Short, quiet motion for moving through the review queue. Each animation is
 * over in about 200 ms, and none plays for people who asked their system for
 * less motion (CSS transitions are covered by the rule in index.css; these,
 * played from script, check for themselves).
 */

/** Fast out, gentle stop. */
export const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** Plays an animation on an element; nothing when the browser can't or motion is reduced. */
export function play(
  element: Element | null | undefined,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions
): Animation | undefined {
  if (!element || typeof element.animate !== 'function') return undefined;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
  return element.animate(keyframes, options);
}
