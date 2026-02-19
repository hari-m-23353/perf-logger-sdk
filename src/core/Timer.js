/**
 * Precision timing utilities for measuring function execution,
 * lifecycle phases, and arbitrary code spans.
 */
export class Timer {
  constructor() {
    /** @type {Map<string, number>} */
    this._marks = new Map();
  }

  /**
   * Set a named timestamp mark
   */
  mark(label) {
    this._marks.set(label, performance.now());
  }

  /**
   * Measure duration between two marks (or from a mark to now)
   * @returns {number} duration in ms, or -1 if start mark not found
   */
  measure(label, startMark, endMark) {
    const start = this._marks.get(startMark);
    if (start === undefined) return -1;

    const end = endMark
      ? this._marks.get(endMark) ?? performance.now()
      : performance.now();

    const duration = end - start;

    try {
      performance.measure(label, { start, duration });
    } catch {
      /* marks may not exist in native timeline */
    }

    return duration;
  }

  /**
   * Wrap any function with automatic timing measurement.
   * Works with both sync and async functions.
   *
   * @param {string} label - Name for this measurement
   * @param {Function} fn - Function to wrap
   * @param {Function} [onMeasure] - Callback with (duration, label, args)
   * @returns {Function} wrapped function
   */
  wrap(label, fn, onMeasure) {
    return function (...args) {
      const start = performance.now();
      let result;

      try {
        result = fn.apply(this, args);
      } catch (err) {
        const duration = performance.now() - start;
        if (onMeasure) onMeasure(duration, label, args, err);
        throw err;
      }

      if (result && typeof result.then === 'function') {
        return result.then(
          (val) => {
            const duration = performance.now() - start;
            if (onMeasure) onMeasure(duration, label, args, null);
            return val;
          },
          (err) => {
            const duration = performance.now() - start;
            if (onMeasure) onMeasure(duration, label, args, err);
            throw err;
          }
        );
      }

      const duration = performance.now() - start;
      if (onMeasure) onMeasure(duration, label, args, null);
      return result;
    };
  }

  /**
   * Time a block using a callback pattern
   * Usage: timer.time('myOp', () => { ... heavy work ... })
   */
  time(label, fn) {
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;
    return { result, duration, label };
  }

  clear() {
    this._marks.clear();
  }
}