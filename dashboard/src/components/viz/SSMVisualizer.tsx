/**
 * SSMVisualizer - React component for SSM visualizations
 *
 * Renders self-similarity matrices and similarity timelines as interactive
 * canvas-based visualizations. Designed for behavioral drift analysis.
 *
 * Features:
 * - High-DPI/Retina display support
 * - Viridis color scale (perceptually uniform)
 * - Threshold highlighting
 * - Interactive tooltips
 * - Dark mode support
 * - Responsive canvas sizing
 * - Accessibility support
 */

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';

// Types
export interface SSMMatrixData {
  matrix: number[][];
  traceIds: string[];
  size: number;
}

export interface SSMTimelineData {
  similarities: number[];
  traceIds: string[];
  mean_similarity: number;
  min_similarity: number;
  trend?: number;
}

export interface SSMVisualizerOptions {
  width?: number;
  height?: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  threshold?: number;
  showLabels?: boolean;
  showGrid?: boolean;
  showTooltip?: boolean;
  animated?: boolean;
}

export type SSMVisualizerMode = 'matrix' | 'timeline';

export interface SSMVisualizerProps {
  /** Mode: 'matrix' for NxN heatmap, 'timeline' for bar chart */
  mode: SSMVisualizerMode;
  /** Matrix data (for mode='matrix') */
  matrixData?: SSMMatrixData;
  /** Timeline data (for mode='timeline') */
  timelineData?: SSMTimelineData;
  /** Configuration options */
  options?: SSMVisualizerOptions;
  /** Override threshold */
  threshold?: number;
  /** Class name for container */
  className?: string;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  content: React.ReactNode;
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
function viridisColor(t: number): string {
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

  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Get contrasting text color (black or white) for a background
 */
function contrastColor(t: number): string {
  // Viridis is dark at low values, light at high
  return t > 0.6 ? '#1a1a2e' : '#ffffff';
}

/**
 * Get color from CSS custom properties (dark mode aware)
 */
function getThemeColor(name: string): string {
  if (typeof document === 'undefined') {
    // SSR fallback
    const fallbacks: Record<string, string> = {
      text: '#1a1a2e',
      'text-secondary': '#4a4a68',
      border: '#e1e4e8',
      bg: '#f8f9fa',
      'bg-elevated': '#ffffff',
      primary: '#0066cc',
    };
    return fallbacks[name] || '#000000';
  }

  const colorMap: Record<string, string> = {
    text:
      getComputedStyle(document.documentElement)
        .getPropertyValue('--color-text')
        .trim() || '#1a1a2e',
    'text-secondary':
      getComputedStyle(document.documentElement)
        .getPropertyValue('--color-text-secondary')
        .trim() || '#4a4a68',
    border:
      getComputedStyle(document.documentElement)
        .getPropertyValue('--color-border')
        .trim() || '#e1e4e8',
    bg:
      getComputedStyle(document.documentElement)
        .getPropertyValue('--color-bg')
        .trim() || '#f8f9fa',
    'bg-elevated':
      getComputedStyle(document.documentElement)
        .getPropertyValue('--color-bg-elevated')
        .trim() || '#ffffff',
    primary:
      getComputedStyle(document.documentElement)
        .getPropertyValue('--color-primary')
        .trim() || '#0066cc',
  };
  return colorMap[name] || '#000000';
}

const DEFAULT_OPTIONS: Required<SSMVisualizerOptions> = {
  width: 400,
  height: 400,
  margin: { top: 40, right: 60, bottom: 50, left: 60 },
  threshold: 0.3,
  showLabels: true,
  showGrid: true,
  showTooltip: true,
  animated: true,
};

/**
 * SSMVisualizer component - renders self-similarity matrices and timelines
 */
export function SSMVisualizer({
  mode,
  matrixData,
  timelineData,
  options: userOptions,
  threshold: thresholdOverride,
  className,
}: SSMVisualizerProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    content: null,
  });

  // Merge options with defaults
  const options = useMemo(
    () => ({
      ...DEFAULT_OPTIONS,
      ...userOptions,
      margin: { ...DEFAULT_OPTIONS.margin, ...userOptions?.margin },
    }),
    [userOptions]
  );

  const threshold = thresholdOverride ?? options.threshold;

  // Calculate plot dimensions
  const plotWidth = options.width - options.margin.left - options.margin.right;
  const plotHeight =
    options.height - options.margin.top - options.margin.bottom;

  /**
   * Draw title text
   */
  const drawTitle = useCallback(
    (ctx: CanvasRenderingContext2D, text: string) => {
      ctx.fillStyle = getThemeColor('text');
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(text, options.width / 2, 20);
    },
    [options.width]
  );

  /**
   * Draw empty state message
   */
  const renderEmpty = useCallback(
    (ctx: CanvasRenderingContext2D, message: string) => {
      ctx.clearRect(0, 0, options.width, options.height);
      ctx.fillStyle = getThemeColor('text-secondary');
      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(message, options.width / 2, options.height / 2);
    },
    [options.width, options.height]
  );

  /**
   * Draw matrix axis labels
   */
  const drawMatrixLabels = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      traceIds: string[],
      cellWidth: number,
      cellHeight: number
    ) => {
      const { margin } = options;
      const n = traceIds.length;

      ctx.fillStyle = getThemeColor('text-secondary');
      ctx.font = '10px ui-monospace, monospace';

      for (let i = 0; i < n; i++) {
        // Truncate long IDs
        const label =
          traceIds[i].length > 8
            ? traceIds[i].slice(0, 6) + '..'
            : traceIds[i];

        // X-axis labels (bottom)
        ctx.save();
        ctx.translate(
          margin.left + i * cellWidth + cellWidth / 2,
          margin.top + n * cellHeight + 10
        );
        ctx.rotate(-Math.PI / 4);
        ctx.textAlign = 'right';
        ctx.fillText(label, 0, 0);
        ctx.restore();

        // Y-axis labels (left)
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          label,
          margin.left - 5,
          margin.top + i * cellHeight + cellHeight / 2
        );
      }
    },
    [options]
  );

  /**
   * Draw color scale legend
   */
  const drawColorScale = useCallback(
    (ctx: CanvasRenderingContext2D, currentThreshold: number) => {
      const { margin, width, height } = options;
      const legendWidth = 15;
      const legendHeight = height - margin.top - margin.bottom;
      const x = width - margin.right + 15;
      const y = margin.top;

      // Draw gradient
      for (let i = 0; i < legendHeight; i++) {
        const t = 1 - i / legendHeight;
        ctx.fillStyle = viridisColor(t);
        ctx.fillRect(x, y + i, legendWidth, 1);
      }

      // Draw border
      ctx.strokeStyle = getThemeColor('border');
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, legendWidth, legendHeight);

      // Draw threshold marker
      const thresholdY = y + legendHeight * (1 - currentThreshold);
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 3, thresholdY);
      ctx.lineTo(x + legendWidth + 3, thresholdY);
      ctx.stroke();

      // Draw scale labels
      ctx.fillStyle = getThemeColor('text-secondary');
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('1.0', x + legendWidth + 5, y + 4);
      ctx.fillText('0.5', x + legendWidth + 5, y + legendHeight / 2);
      ctx.fillText('0.0', x + legendWidth + 5, y + legendHeight);
    },
    [options]
  );

  /**
   * Draw rounded bar (for timeline chart)
   */
  const drawRoundedBar = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      width: number,
      height: number,
      radius: number
    ) => {
      if (height < radius * 2) {
        ctx.fillRect(x, y, width, height);
        return;
      }

      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      ctx.fill();
    },
    []
  );

  /**
   * Draw axes for timeline chart
   */
  const drawAxes = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      n: number,
      traceIds: string[]
    ) => {
      const { margin } = options;

      // Y-axis
      ctx.strokeStyle = getThemeColor('border');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(margin.left, margin.top);
      ctx.lineTo(margin.left, margin.top + plotHeight);
      ctx.lineTo(margin.left + plotWidth, margin.top + plotHeight);
      ctx.stroke();

      // Y-axis ticks and labels
      ctx.fillStyle = getThemeColor('text-secondary');
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      for (let i = 0; i <= 10; i += 2) {
        const y = margin.top + plotHeight * (1 - i / 10);
        const value = i / 10;

        // Tick
        ctx.beginPath();
        ctx.moveTo(margin.left - 5, y);
        ctx.lineTo(margin.left, y);
        ctx.stroke();

        // Label
        ctx.fillText(value.toFixed(1), margin.left - 8, y);
      }

      // Y-axis title
      ctx.save();
      ctx.translate(15, margin.top + plotHeight / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = getThemeColor('text');
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText('Similarity Score', 0, 0);
      ctx.restore();

      // X-axis labels
      if (options.showLabels && traceIds) {
        const barWidth = plotWidth / n;
        ctx.textAlign = 'center';

        for (let i = 0; i < n; i++) {
          const x = margin.left + i * barWidth + barWidth / 2;

          // Show every label if few traces, otherwise show subset
          if (n <= 10 || i % Math.ceil(n / 10) === 0) {
            ctx.save();
            ctx.translate(x, margin.top + plotHeight + 10);
            ctx.rotate(-Math.PI / 4);
            ctx.textAlign = 'right';
            ctx.fillStyle = getThemeColor('text-secondary');
            ctx.font = '9px ui-monospace, monospace';

            const label =
              traceIds[i].length > 10
                ? traceIds[i].slice(0, 8) + '..'
                : traceIds[i];
            ctx.fillText(label, 0, 0);
            ctx.restore();
          }
        }
      }

      // X-axis title
      ctx.fillStyle = getThemeColor('text');
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        'Trace Sequence',
        margin.left + plotWidth / 2,
        options.height - 5
      );
    },
    [options, plotWidth, plotHeight]
  );

  /**
   * Draw trend indicator arrow
   */
  const drawTrendIndicator = useCallback(
    (ctx: CanvasRenderingContext2D, trend: number) => {
      const { margin } = options;
      const x = margin.left + plotWidth - 60;
      const y = margin.top + 15;

      // Draw background
      ctx.fillStyle = getThemeColor('bg-elevated');
      ctx.strokeStyle = getThemeColor('border');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x - 5, y - 12, 55, 22, 4);
      ctx.fill();
      ctx.stroke();

      // Draw trend label and arrow
      ctx.fillStyle =
        trend > 0.01 ? '#28a745' : trend < -0.01 ? '#dc3545' : getThemeColor('text-secondary');
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'left';

      const arrow = trend > 0.01 ? '\u2197' : trend < -0.01 ? '\u2198' : '\u2192';
      const label = trend > 0.01 ? 'Rising' : trend < -0.01 ? 'Falling' : 'Stable';

      ctx.fillText(`${arrow} ${label}`, x, y + 3);
    },
    [options, plotWidth]
  );

  /**
   * Count pairs below threshold in matrix
   */
  const countBelowThreshold = useCallback(
    (matrix: number[][], currentThreshold: number): number => {
      let count = 0;
      const n = matrix.length;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (matrix[i][j] < currentThreshold) count++;
        }
      }
      return count;
    },
    []
  );

  /**
   * Render NxN self-similarity matrix as a heatmap
   */
  const renderMatrix = useCallback(
    (ctx: CanvasRenderingContext2D, data: SSMMatrixData) => {
      const { matrix, traceIds, size } = data;

      if (!matrix || size === 0) {
        renderEmpty(ctx, 'No data to display');
        return;
      }

      const { margin } = options;

      // Clear canvas
      ctx.clearRect(0, 0, options.width, options.height);

      // Draw title
      drawTitle(ctx, 'Self-Similarity Matrix');

      // Calculate cell dimensions
      const n = matrix.length;
      const cellWidth = plotWidth / n;
      const cellHeight = plotHeight / n;

      // Draw cells
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const similarity = matrix[i][j];
          const x = margin.left + j * cellWidth;
          const y = margin.top + i * cellHeight;

          // Fill cell with viridis color
          ctx.fillStyle = viridisColor(similarity);
          ctx.fillRect(x, y, cellWidth, cellHeight);

          // Highlight below-threshold cells (not on diagonal)
          if (similarity < threshold && i !== j) {
            ctx.strokeStyle = '#ff4444';
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);
          }

          // Show value in cell if cells are large enough
          if (cellWidth > 40 && cellHeight > 25) {
            ctx.fillStyle = contrastColor(similarity);
            ctx.font = '10px ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(
              similarity.toFixed(2),
              x + cellWidth / 2,
              y + cellHeight / 2
            );
          }
        }
      }

      // Draw grid
      if (options.showGrid) {
        ctx.strokeStyle = getThemeColor('border');
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= n; i++) {
          // Vertical lines
          ctx.beginPath();
          ctx.moveTo(margin.left + i * cellWidth, margin.top);
          ctx.lineTo(margin.left + i * cellWidth, margin.top + plotHeight);
          ctx.stroke();
          // Horizontal lines
          ctx.beginPath();
          ctx.moveTo(margin.left, margin.top + i * cellHeight);
          ctx.lineTo(margin.left + plotWidth, margin.top + i * cellHeight);
          ctx.stroke();
        }
      }

      // Draw axis labels
      if (options.showLabels && traceIds) {
        drawMatrixLabels(ctx, traceIds, cellWidth, cellHeight);
      }

      // Draw color scale legend
      drawColorScale(ctx, threshold);
    },
    [
      options,
      threshold,
      plotWidth,
      plotHeight,
      drawTitle,
      renderEmpty,
      drawMatrixLabels,
      drawColorScale,
    ]
  );

  /**
   * Render similarity timeline as a bar chart
   */
  const renderTimeline = useCallback(
    (ctx: CanvasRenderingContext2D, data: SSMTimelineData) => {
      const { similarities, traceIds, mean_similarity, trend } = data;

      if (!similarities || similarities.length === 0) {
        renderEmpty(ctx, 'No data to display');
        return;
      }

      const { margin } = options;

      // Clear canvas
      ctx.clearRect(0, 0, options.width, options.height);

      // Draw title
      drawTitle(ctx, 'Trace-to-Card Similarity');

      const n = similarities.length;
      const barWidth = (plotWidth / n) * 0.8;
      const barSpacing = (plotWidth / n) * 0.2;
      const maxSim = 1.0;

      // Draw threshold line
      const thresholdY = margin.top + plotHeight * (1 - threshold / maxSim);
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(margin.left, thresholdY);
      ctx.lineTo(margin.left + plotWidth, thresholdY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw threshold label
      ctx.fillStyle = '#ff6b6b';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(
        `Threshold: ${threshold.toFixed(2)}`,
        margin.left + plotWidth + 5,
        thresholdY + 4
      );

      // Draw mean line
      const meanY = margin.top + plotHeight * (1 - mean_similarity / maxSim);
      ctx.strokeStyle = getThemeColor('primary');
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 2]);
      ctx.beginPath();
      ctx.moveTo(margin.left, meanY);
      ctx.lineTo(margin.left + plotWidth, meanY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw mean label
      ctx.fillStyle = getThemeColor('primary');
      ctx.fillText(
        `Mean: ${mean_similarity.toFixed(2)}`,
        margin.left + plotWidth + 5,
        meanY + 4
      );

      // Draw bars
      for (let i = 0; i < n; i++) {
        const sim = similarities[i];
        const barHeight = (sim / maxSim) * plotHeight;
        const x = margin.left + i * (barWidth + barSpacing) + barSpacing / 2;
        const y = margin.top + plotHeight - barHeight;

        // Color based on threshold
        const isBelowThreshold = sim < threshold;
        ctx.fillStyle = isBelowThreshold ? '#ff6b6b' : viridisColor(sim);

        // Draw bar with rounded top
        drawRoundedBar(ctx, x, y, barWidth, barHeight, 3);

        // Draw value label above bar
        if (barWidth > 30) {
          ctx.fillStyle = getThemeColor('text-secondary');
          ctx.font = '10px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(sim.toFixed(2), x + barWidth / 2, y - 5);
        }
      }

      // Draw axes
      drawAxes(ctx, n, traceIds);

      // Draw trend indicator
      if (trend !== undefined) {
        drawTrendIndicator(ctx, trend);
      }
    },
    [
      options,
      threshold,
      plotWidth,
      plotHeight,
      drawTitle,
      renderEmpty,
      drawRoundedBar,
      drawAxes,
      drawTrendIndicator,
    ]
  );

  /**
   * Handle mouse move for tooltips
   */
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!options.showTooltip || !canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const { margin } = options;

      // Check if within plot area
      if (
        x < margin.left ||
        x > margin.left + plotWidth ||
        y < margin.top ||
        y > margin.top + plotHeight
      ) {
        setTooltip((prev) => ({ ...prev, visible: false }));
        return;
      }

      if (mode === 'matrix' && matrixData) {
        const { matrix, traceIds } = matrixData;
        const n = matrix.length;
        const cellWidth = plotWidth / n;
        const cellHeight = plotHeight / n;

        const col = Math.floor((x - margin.left) / cellWidth);
        const row = Math.floor((y - margin.top) / cellHeight);

        if (row >= 0 && row < n && col >= 0 && col < n) {
          const similarity = matrix[row][col];
          const isBelowThreshold = similarity < threshold && row !== col;

          setTooltip({
            visible: true,
            x: e.clientX - rect.left + 10,
            y: e.clientY - rect.top + 10,
            content: (
              <div className="ssm-tooltip">
                <div className="ssm-tooltip-title">
                  {traceIds[row]} &harr; {traceIds[col]}
                </div>
                <div
                  className={`ssm-tooltip-value ${isBelowThreshold ? 'below-threshold' : ''}`}
                >
                  Similarity: <strong>{similarity.toFixed(4)}</strong>
                </div>
                {isBelowThreshold && (
                  <div className="ssm-tooltip-warning">Below threshold</div>
                )}
              </div>
            ),
          });
        }
      } else if (mode === 'timeline' && timelineData) {
        const { similarities, traceIds } = timelineData;
        const n = similarities.length;
        const barWidth = plotWidth / n;
        const barIndex = Math.floor((x - margin.left) / barWidth);

        if (barIndex >= 0 && barIndex < n) {
          const similarity = similarities[barIndex];
          const isBelowThreshold = similarity < threshold;

          setTooltip({
            visible: true,
            x: e.clientX - rect.left + 10,
            y: e.clientY - rect.top + 10,
            content: (
              <div className="ssm-tooltip">
                <div className="ssm-tooltip-title">{traceIds[barIndex]}</div>
                <div
                  className={`ssm-tooltip-value ${isBelowThreshold ? 'below-threshold' : ''}`}
                >
                  Similarity: <strong>{similarity.toFixed(4)}</strong>
                </div>
                {isBelowThreshold && (
                  <div className="ssm-tooltip-warning">Below threshold</div>
                )}
                <div className="ssm-tooltip-meta">
                  Trace {barIndex + 1} of {n}
                </div>
              </div>
            ),
          });
        }
      }
    },
    [mode, matrixData, timelineData, options, threshold, plotWidth, plotHeight]
  );

  const handleMouseLeave = useCallback(() => {
    setTooltip((prev) => ({ ...prev, visible: false }));
  }, []);

  // Main render effect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // High-DPI support
    const dpr = window.devicePixelRatio || 1;
    canvas.width = options.width * dpr;
    canvas.height = options.height * dpr;
    canvas.style.width = `${options.width}px`;
    canvas.style.height = `${options.height}px`;
    ctx.scale(dpr, dpr);

    // Render based on mode
    if (mode === 'matrix' && matrixData) {
      renderMatrix(ctx, matrixData);

      // Update ARIA label
      const n = matrixData.matrix.length;
      canvas.setAttribute(
        'aria-label',
        `Self-similarity matrix with ${n} traces. ` +
          `${countBelowThreshold(matrixData.matrix, threshold)} pairs below threshold ${threshold}.`
      );
    } else if (mode === 'timeline' && timelineData) {
      renderTimeline(ctx, timelineData);

      // Update ARIA label
      const belowCount = timelineData.similarities.filter(
        (s) => s < threshold
      ).length;
      canvas.setAttribute(
        'aria-label',
        `Similarity timeline with ${timelineData.similarities.length} traces. ` +
          `Mean similarity: ${timelineData.mean_similarity.toFixed(2)}. ` +
          `${belowCount} traces below threshold ${threshold}.`
      );
    } else {
      renderEmpty(ctx, 'No data to display');
    }
  }, [
    mode,
    matrixData,
    timelineData,
    options,
    threshold,
    renderMatrix,
    renderTimeline,
    renderEmpty,
    countBelowThreshold,
  ]);

  return (
    <div
      ref={containerRef}
      className={`ssm-visualizer ${className || ''}`}
      style={{ position: 'relative', width: options.width, height: options.height }}
    >
      <canvas
        ref={canvasRef}
        className="ssm-canvas"
        role="img"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {tooltip.visible && (
        <div
          className="ssm-tooltip"
          role="tooltip"
          style={{
            position: 'absolute',
            left: tooltip.x,
            top: tooltip.y,
            pointerEvents: 'none',
          }}
        >
          {tooltip.content}
        </div>
      )}
    </div>
  );
}

export default SSMVisualizer;
