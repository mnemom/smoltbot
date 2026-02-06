/**
 * Visualization components for smoltbot dashboard
 *
 * Components:
 * - SSMFingerprint: Canvas-based heatmap for cognitive similarity fingerprints
 * - SSMVisualizer: Full matrix and timeline visualizations with tooltips
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
