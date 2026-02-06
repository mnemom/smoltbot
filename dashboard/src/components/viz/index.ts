/**
 * Visualization components for smoltbot dashboard
 *
 * Components:
 * - SSMFingerprint: Canvas-based heatmap for cognitive similarity fingerprints
 * - SSMVisualizer: Full matrix and timeline visualizations with tooltips
 * - ThresholdSlider: Simple slider for SSM threshold control
 * - ConfidenceRadar: 5-axis radar chart for Braid confidence metadata
 */

// SSMFingerprint - thumbnail + tooltip heatmap
export { SSMFingerprint } from './SSMFingerprint';
export type { SSMFingerprintProps } from './SSMFingerprint';

// SSMVisualizer - full matrix/timeline visualization
export { SSMVisualizer } from './SSMVisualizer';
export type {
  SSMVisualizerProps,
  SSMVisualizerOptions,
  SSMVisualizerMode,
  SSMMatrixData,
  SSMTimelineData,
} from './SSMVisualizer';

// ThresholdSlider - threshold control slider with amber styling
export { ThresholdSlider } from './ThresholdSlider';
export type { ThresholdSliderProps } from './ThresholdSlider';

// ConfidenceRadar - 5-axis radar chart for confidence metadata
export { ConfidenceRadar } from './ConfidenceRadar';
export type { ConfidenceRadarProps, ConfidenceData } from './ConfidenceRadar';
