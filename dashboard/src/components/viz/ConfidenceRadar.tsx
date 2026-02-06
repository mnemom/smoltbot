/**
 * ConfidenceRadar - 5-axis radar chart for Braid confidence metadata
 *
 * Canvas-based pentagon radar visualization showing:
 * - epistemic: Confidence in knowledge claims
 * - source_reliability: Trust in data sources
 * - temporal_decay: How fresh/relevant the information is
 * - value_coherence: Alignment with stated values
 * - translation: Accuracy of concept translation
 */

import React, { useRef, useEffect, useCallback } from 'react';

export interface ConfidenceData {
  epistemic: number;
  source_reliability: number;
  temporal_decay: number;
  value_coherence: number;
  translation: number;
}

export interface ConfidenceRadarProps {
  /** Confidence values for each axis (0-1) */
  confidence: ConfidenceData;
  /** Canvas width in pixels (default: 150) */
  width?: number;
  /** Canvas height in pixels (default: 150) */
  height?: number;
}

/**
 * Viridis color scale - perceptually uniform, colorblind-friendly
 * Interpolated from matplotlib's viridis colormap
 */
const VIRIDIS: [number, number, number][] = [
  [68, 1, 84], // 0.0 - dark purple
  [72, 35, 116], // 0.1
  [64, 67, 135], // 0.2
  [52, 94, 141], // 0.3
  [41, 120, 142], // 0.4
  [32, 144, 140], // 0.5
  [34, 167, 132], // 0.6
  [68, 190, 112], // 0.7
  [121, 209, 81], // 0.8
  [189, 222, 38], // 0.9
  [253, 231, 37], // 1.0 - bright yellow
];

/**
 * Interpolate viridis color for a value in [0, 1]
 */
function viridisColor(t: number, alpha: number = 1): string {
  t = Math.max(0, Math.min(1, t));
  const idx = t * (VIRIDIS.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.min(lower + 1, VIRIDIS.length - 1);
  const frac = idx - lower;

  const r = Math.round(
    VIRIDIS[lower][0] + frac * (VIRIDIS[upper][0] - VIRIDIS[lower][0])
  );
  const g = Math.round(
    VIRIDIS[lower][1] + frac * (VIRIDIS[upper][1] - VIRIDIS[lower][1])
  );
  const b = Math.round(
    VIRIDIS[lower][2] + frac * (VIRIDIS[upper][2] - VIRIDIS[lower][2])
  );

  return alpha < 1 ? `rgba(${r}, ${g}, ${b}, ${alpha})` : `rgb(${r}, ${g}, ${b})`;
}

/** Axis labels and their display names */
const AXES: { key: keyof ConfidenceData; label: string }[] = [
  { key: 'epistemic', label: 'Epistemic' },
  { key: 'source_reliability', label: 'Source' },
  { key: 'temporal_decay', label: 'Temporal' },
  { key: 'value_coherence', label: 'Values' },
  { key: 'translation', label: 'Translation' },
];

/**
 * ConfidenceRadar component
 *
 * Renders a 5-axis radar chart showing confidence levels across dimensions.
 */
export function ConfidenceRadar({
  confidence,
  width = 150,
  height = 150,
}: ConfidenceRadarProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /**
   * Calculate point coordinates for a value on a given axis
   */
  const getPoint = useCallback(
    (
      centerX: number,
      centerY: number,
      radius: number,
      axisIndex: number,
      value: number
    ): { x: number; y: number } => {
      // Start from top (-90 degrees) and go clockwise
      const angle = (Math.PI * 2 * axisIndex) / AXES.length - Math.PI / 2;
      const r = radius * value;
      return {
        x: centerX + r * Math.cos(angle),
        y: centerY + r * Math.sin(angle),
      };
    },
    []
  );

  /**
   * Draw the radar chart
   */
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const dpr = window.devicePixelRatio || 1;
      const w = width;
      const h = height;

      // Clear canvas
      ctx.clearRect(0, 0, w * dpr, h * dpr);

      // Calculate dimensions
      const centerX = w / 2;
      const centerY = h / 2;
      const maxRadius = Math.min(w, h) / 2 - 25; // Leave room for labels
      const labelRadius = maxRadius + 15;

      // Calculate mean confidence for fill color
      const values = AXES.map((axis) => confidence[axis.key]);
      const meanConfidence =
        values.reduce((sum, v) => sum + v, 0) / values.length;

      // Draw background pentagon rings (grid)
      ctx.strokeStyle = 'rgba(128, 128, 128, 0.2)';
      ctx.lineWidth = 1;
      for (let ring = 0.2; ring <= 1; ring += 0.2) {
        ctx.beginPath();
        for (let i = 0; i <= AXES.length; i++) {
          const point = getPoint(
            centerX,
            centerY,
            maxRadius,
            i % AXES.length,
            ring
          );
          if (i === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        }
        ctx.closePath();
        ctx.stroke();
      }

      // Draw axis lines
      ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)';
      for (let i = 0; i < AXES.length; i++) {
        const point = getPoint(centerX, centerY, maxRadius, i, 1);
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }

      // Draw filled data area
      ctx.beginPath();
      for (let i = 0; i <= AXES.length; i++) {
        const axis = AXES[i % AXES.length];
        const value = confidence[axis.key];
        const point = getPoint(centerX, centerY, maxRadius, i % AXES.length, value);
        if (i === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }
      ctx.closePath();

      // Fill with viridis color based on mean confidence
      ctx.fillStyle = viridisColor(meanConfidence, 0.35);
      ctx.fill();

      // Stroke outline with stronger viridis color
      ctx.strokeStyle = viridisColor(meanConfidence, 0.9);
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw data points
      for (let i = 0; i < AXES.length; i++) {
        const axis = AXES[i];
        const value = confidence[axis.key];
        const point = getPoint(centerX, centerY, maxRadius, i, value);

        // Point circle
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = viridisColor(value);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Draw axis labels
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'var(--color-text-secondary, #4a4a68)';

      for (let i = 0; i < AXES.length; i++) {
        const axis = AXES[i];
        const labelPoint = getPoint(centerX, centerY, labelRadius, i, 1);

        // Adjust text alignment based on position
        const angle = (Math.PI * 2 * i) / AXES.length - Math.PI / 2;
        if (Math.abs(Math.cos(angle)) < 0.1) {
          ctx.textAlign = 'center';
        } else if (Math.cos(angle) > 0) {
          ctx.textAlign = 'left';
        } else {
          ctx.textAlign = 'right';
        }

        if (Math.abs(Math.sin(angle)) < 0.1) {
          ctx.textBaseline = 'middle';
        } else if (Math.sin(angle) > 0) {
          ctx.textBaseline = 'top';
        } else {
          ctx.textBaseline = 'bottom';
        }

        ctx.fillText(axis.label, labelPoint.x, labelPoint.y);
      }
    },
    [confidence, width, height, getPoint]
  );

  // Render effect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // High-DPI support
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    draw(ctx);
  }, [confidence, width, height, draw]);

  // Calculate mean for accessibility
  const values = AXES.map((axis) => confidence[axis.key]);
  const meanConfidence = values.reduce((sum, v) => sum + v, 0) / values.length;

  return (
    <canvas
      ref={canvasRef}
      className="confidence-radar"
      role="img"
      aria-label={`Confidence radar chart. Mean confidence: ${meanConfidence.toFixed(2)}. ` +
        AXES.map((axis) => `${axis.label}: ${confidence[axis.key].toFixed(2)}`).join(', ')
      }
      style={{ width, height }}
    />
  );
}

export default ConfidenceRadar;
