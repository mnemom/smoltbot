/**
 * ThresholdSlider - Simple slider for SSM threshold control
 *
 * A styled range input for adjusting similarity thresholds.
 * Features amber color scheme and preset marks at 0.3 (default) and 0.5.
 */

import React, { useCallback, useId } from 'react';

export interface ThresholdSliderProps {
  /** Current threshold value (0-1) */
  value: number;
  /** Callback when value changes */
  onChange: (value: number) => void;
  /** Optional label text */
  label?: string;
}

/** Amber color for slider handle and filled track */
const AMBER_COLOR = '#D97706';

/**
 * ThresholdSlider component
 *
 * Renders a range slider with amber styling and threshold marks.
 */
export function ThresholdSlider({
  value,
  onChange,
  label,
}: ThresholdSliderProps): React.ReactElement {
  const id = useId();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(parseFloat(e.target.value));
    },
    [onChange]
  );

  // Calculate filled track percentage
  const fillPercent = value * 100;

  return (
    <div className="threshold-slider">
      {label && (
        <label htmlFor={id} className="threshold-slider__label">
          {label}
        </label>
      )}
      <div className="threshold-slider__container">
        <input
          id={id}
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value}
          onChange={handleChange}
          className="threshold-slider__input"
          style={{
            background: `linear-gradient(to right, ${AMBER_COLOR} 0%, ${AMBER_COLOR} ${fillPercent}%, #e5e7eb ${fillPercent}%, #e5e7eb 100%)`,
          }}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={value}
          aria-valuetext={`Threshold: ${value.toFixed(2)}`}
        />
        <div className="threshold-slider__marks">
          <span
            className="threshold-slider__mark"
            style={{ left: '30%' }}
            data-value="0.3"
            title="Default threshold (0.3)"
          />
          <span
            className="threshold-slider__mark"
            style={{ left: '50%' }}
            data-value="0.5"
            title="Mid threshold (0.5)"
          />
        </div>
        <div className="threshold-slider__value">
          {value.toFixed(2)}
        </div>
      </div>
      <style>{`
        .threshold-slider {
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 100%;
        }

        .threshold-slider__label {
          font-size: 12px;
          font-weight: 500;
          color: var(--color-text-secondary, #4a4a68);
        }

        .threshold-slider__container {
          position: relative;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .threshold-slider__input {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 6px;
          border-radius: 3px;
          outline: none;
          cursor: pointer;
        }

        .threshold-slider__input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: ${AMBER_COLOR};
          cursor: pointer;
          border: 2px solid #fff;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          transition: transform 0.1s ease;
        }

        .threshold-slider__input::-webkit-slider-thumb:hover {
          transform: scale(1.1);
        }

        .threshold-slider__input::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: ${AMBER_COLOR};
          cursor: pointer;
          border: 2px solid #fff;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          transition: transform 0.1s ease;
        }

        .threshold-slider__input::-moz-range-thumb:hover {
          transform: scale(1.1);
        }

        .threshold-slider__marks {
          position: absolute;
          left: 0;
          right: 50px;
          top: 50%;
          transform: translateY(-50%);
          pointer-events: none;
        }

        .threshold-slider__mark {
          position: absolute;
          width: 2px;
          height: 12px;
          background: var(--color-border, #e1e4e8);
          transform: translateX(-50%);
          top: -3px;
        }

        .threshold-slider__mark::after {
          content: attr(data-value);
          position: absolute;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 9px;
          color: var(--color-text-secondary, #4a4a68);
        }

        .threshold-slider__value {
          min-width: 40px;
          font-size: 13px;
          font-family: ui-monospace, monospace;
          font-weight: 600;
          color: ${AMBER_COLOR};
          text-align: right;
        }
      `}</style>
    </div>
  );
}

export default ThresholdSlider;
