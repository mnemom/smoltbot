/**
 * SSMFingerprint - Canvas-based heatmap renderer for SSM cognitive fingerprints.
 *
 * Renders a self-similarity matrix as a color-coded heatmap.
 * - Thumbnail mode (32x16): shows one row (a message's similarity to all others)
 * - Tooltip mode (200x200): full NxN matrix on hover
 *
 * Color scale: 0=dark blue -> 0.5=yellow -> 1.0=bright white
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';

// Types
interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface SSMFingerprintProps {
  /** NxN similarity matrix (array of arrays of floats) */
  matrix: number[][] | null;
  /** Array of message IDs corresponding to matrix rows */
  messageIds?: string[];
  /** (optional) Which message to highlight / show row for */
  messageId?: string;
  /** Thread ID (for labeling) - reserved for future use */
  threadId?: string;
}

/**
 * Map a similarity value (0-1) to an RGB color.
 * 0.0 = dark blue (#0B1428)
 * 0.5 = yellow (#FBBF24)
 * 1.0 = bright white (#FFFFFF)
 */
function similarityToColor(value: number): RGB {
  const v = Math.max(0, Math.min(1, value));

  let r: number, g: number, b: number;
  if (v <= 0.5) {
    // Dark blue -> yellow
    const t = v / 0.5;
    r = Math.round(11 + (251 - 11) * t);
    g = Math.round(20 + (191 - 20) * t);
    b = Math.round(40 + (36 - 40) * t);
  } else {
    // Yellow -> white
    const t = (v - 0.5) / 0.5;
    r = Math.round(251 + (255 - 251) * t);
    g = Math.round(191 + (255 - 191) * t);
    b = Math.round(36 + (255 - 36) * t);
  }

  return { r, g, b };
}

/**
 * Draw a single row of the matrix onto a canvas (thumbnail mode).
 */
function drawRow(
  canvas: HTMLCanvasElement,
  matrix: number[][],
  rowIndex: number
): void {
  if (!canvas || !matrix || matrix.length === 0) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const n = matrix[rowIndex].length;
  const cellW = canvas.width / n;
  const cellH = canvas.height;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let j = 0; j < n; j++) {
    const val = matrix[rowIndex][j];
    const { r, g, b } = similarityToColor(val);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(Math.floor(j * cellW), 0, Math.ceil(cellW), cellH);
  }
}

/**
 * Draw the full NxN matrix onto a canvas (expanded mode).
 */
function drawMatrix(
  canvas: HTMLCanvasElement,
  matrix: number[][],
  highlightRow: number | null
): void {
  if (!canvas || !matrix || matrix.length === 0) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const n = matrix.length;
  const cellW = canvas.width / n;
  const cellH = canvas.height / n;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const val = matrix[i][j];
      const { r, g, b } = similarityToColor(val);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(
        Math.floor(j * cellW),
        Math.floor(i * cellH),
        Math.ceil(cellW),
        Math.ceil(cellH)
      );
    }
  }

  // Highlight the selected row
  if (highlightRow != null && highlightRow >= 0 && highlightRow < n) {
    ctx.strokeStyle = 'rgba(77, 163, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      0,
      Math.floor(highlightRow * cellH),
      canvas.width,
      Math.ceil(cellH)
    );
  }
}

/**
 * SSMFingerprint component.
 *
 * Renders a thumbnail of an SSM row, with a full matrix tooltip on hover.
 */
export function SSMFingerprint({
  matrix,
  messageIds,
  messageId,
  threadId: _threadId,
}: SSMFingerprintProps): React.ReactElement | null {
  const thumbnailRef = useRef<HTMLCanvasElement>(null);
  const expandedRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [showBelow, setShowBelow] = useState(false);

  // Determine which row index this message corresponds to
  const rowIndex =
    messageId && messageIds ? messageIds.indexOf(messageId) : -1;

  // Draw thumbnail
  useEffect(() => {
    if (!thumbnailRef.current || !matrix || matrix.length === 0) return;

    if (rowIndex >= 0) {
      drawRow(thumbnailRef.current, matrix, rowIndex);
    } else {
      // No specific message - draw diagonal as a summary
      const ctx = thumbnailRef.current.getContext('2d');
      if (!ctx) return;

      const n = matrix.length;
      const cellW = thumbnailRef.current.width / n;
      ctx.clearRect(0, 0, thumbnailRef.current.width, thumbnailRef.current.height);
      for (let i = 0; i < n; i++) {
        const val = matrix[i][i];
        const { r, g, b } = similarityToColor(val);
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(
          Math.floor(i * cellW),
          0,
          Math.ceil(cellW),
          thumbnailRef.current.height
        );
      }
    }
  }, [matrix, rowIndex]);

  // Draw expanded matrix when tooltip appears
  useEffect(() => {
    if (!expandedRef.current || !matrix || matrix.length === 0 || !hovered)
      return;
    drawMatrix(expandedRef.current, matrix, rowIndex >= 0 ? rowIndex : null);
  }, [matrix, rowIndex, hovered]);

  const handleMouseEnter = useCallback(() => {
    // Check if tooltip would be clipped above - if so, show below
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      // Tooltip is ~260px tall (200px canvas + padding + label)
      setShowBelow(rect.top < 280);
    }
    setHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => setHovered(false), []);

  if (!matrix || matrix.length === 0) return null;

  return (
    <span
      className="ssm-fingerprint"
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Thumbnail canvas */}
      <span className="ssm-fingerprint--thumbnail">
        <canvas
          ref={thumbnailRef}
          className="ssm-fingerprint__canvas"
          width={64}
          height={16}
          style={{ width: '32px', height: '16px' }}
        />
      </span>

      {/* Tooltip on hover - positioned above or below depending on available space */}
      {hovered && (
        <div
          className={`ssm-fingerprint--tooltip${
            showBelow ? ' ssm-fingerprint--tooltip-below' : ''
          }`}
        >
          <canvas
            ref={expandedRef}
            className="ssm-fingerprint__canvas"
            width={400}
            height={400}
            style={{ width: '200px', height: '200px' }}
          />
          <div className="ssm-fingerprint__label">
            {`${matrix.length} messages`}
            {messageId ? ` | row: ${messageId.slice(0, 8)}...` : ''}
          </div>
        </div>
      )}
    </span>
  );
}

export default SSMFingerprint;
