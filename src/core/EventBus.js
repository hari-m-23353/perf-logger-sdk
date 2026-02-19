/**
 * Internal event bus for decoupled communication between SDK modules.
 * Collectors emit metrics -> AnomalyEngine listens -> Transport listens
 *
 * Event Types:
 *   'metric:collected'   - A new metric data point
 *   'anomaly:detected'   - An anomaly was found
 *   'baseline:updated'   - Baseline stats recalculated
 *   'lifecycle:event'    - Framework component lifecycle
 *   'transport:flushed'  - Batch was sent
 *   'error:internal'     - SDK internal error
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();

    /** @type {Array<Object>} */
    this._history = [];

    this._maxHistory = 1000;
    this._sessionId = null;
  }

  /**
   * Subscribe to an event type
   * @param {string} type
   * @param {Function} listener
   * @returns {Function} unsubscribe function
   */
  on(type, listener) {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }
    this._listeners.get(type).add(listener);

    return () => this._listeners.get(type)?.delete(listener);
  }

  /**
   * Subscribe to an event type, but only fire once
   */
  once(type, listener) {
    const unsub = this.on(type, (event) => {
      unsub();
      listener(event);
    });
    return unsub;
  }

  /**
   * Emit an event to all subscribers
   * @param {string} type
   * @param {string} source - Which module emitted this
   * @param {*} payload
   */
  emit(type, source, payload) {
    const event = {
      type,
      timestamp: performance.now(),
      wallTime: Date.now(),
      source,
      payload,
      sessionId: this._getSessionId(),
      pageUrl: window.location.href,
    };

    this._history.push(event);
    if (this._history.length > this._maxHistory) {
      this._history.shift();
    }

    const listeners = this._listeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (e) {
          console.warn('[PerfSDK] Listener error on "