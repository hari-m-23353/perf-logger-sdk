/**
 * Default SDK Configuration
 * Every option is overridable at init time
 */
export const DEFAULT_CONFIG = {
  appName: 'unknown',
  version: '1.0.0',
  environment: 'production', // 'development' | 'staging' | 'production'
  framework: 'auto',         // 'lyte' | 'react' | 'vue' | 'vanilla' | 'auto'

  collectors: {
    jsExecution: true,
    memory: true,
    cpu: true,
    dom: true,
    network: true,
    webVitals: true,
  },

  anomaly: {
    enabled: true,
    strategy: 'ema',          // 'zscore' | 'iqr' | 'ema' | 'threshold'
    sensitivity: 'medium',    // 'low' | 'medium' | 'high'
    baselineLearningPeriod: 30, // seconds to learn "normal" before alerting
  },

  transport: {
    type: 'beacon',           // 'beacon' | 'fetch' | 'console' | 'localStorage' | 'custom'
    endpoint: null,
    batchSize: 20,
    flushIntervalMs: 5000,
    samplingRate: 1.0,        // 0-1, 1 = capture everything
    smartSampling: false,     // AI-driven adaptive sampling
    retryAttempts: 3,
  },

  debug: false,
  maxEventsPerMinute: 500,
  enableOverlay: false,       // In-page dev widget

  // User hooks
  onAnomaly: null,            // (anomalyEvent) => {}
  onMetric: null,             // (metricEntry) => {}
  beforeSend: null,           // (batch) => batch (transform/filter before sending)
};

/**
 * Deep merge user config with defaults
 */
export function mergeConfig(userConfig) {
  const merged = { ...DEFAULT_CONFIG };

  for (const key of Object.keys(userConfig)) {
    if (
      userConfig[key] !== null &&
      typeof userConfig[key] === 'object' &&
      !Array.isArray(userConfig[key])
    ) {
      merged[key] = { ...DEFAULT_CONFIG[key], ...userConfig[key] };
    } else {
      merged[key] = userConfig[key];
    }
  }

  return merged;
}