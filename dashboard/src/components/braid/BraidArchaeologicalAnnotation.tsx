/**
 * BraidArchaeologicalAnnotation - UI for annotating messages retrospectively.
 *
 * Archaeological Mode allows retrospective annotation of messages:
 * - Button to annotate a message
 * - Form for metadata fields (performative, affect, confidence, etc.)
 * - Annotation note field
 * - Only enabled for original sender
 */

import type { FormEvent } from 'react';
import { useState, useCallback } from 'react';

// Types
interface PerformativeOption {
  value: string;
  label: string;
  description: string;
}

interface AffectStance {
  value: string;
  label: string;
}

interface ConfidenceLevel {
  value: number;
  label: string;
  dots: number;
}

interface Annotation {
  message_id: string;
  performative?: string | null;
  is_custom_performative?: boolean;
  affect?: { stance: string } | null;
  confidence?: { epistemic: number } | null;
  note?: string | null;
  timestamp?: string;
  custom_performative?: string;
}

interface AnnotationButtonProps {
  onClick: () => void;
  disabled: boolean;
  title: string;
}

interface PerformativeSelectorProps {
  value: string;
  onChange: (value: string) => void;
  customValue: string;
  onCustomChange: (value: string) => void;
}

interface AffectSelectorProps {
  value: string | null;
  onChange: (value: string | null) => void;
}

interface ConfidenceSelectorProps {
  value: number | null;
  onChange: (value: number | null) => void;
}

interface AnnotationFormProps {
  messageId: string;
  onSubmit: (annotation: Annotation) => Promise<void>;
  onCancel: () => void;
  initialValues?: Partial<Annotation>;
}

export interface BraidArchaeologicalAnnotationProps {
  messageId: string;
  senderId: string;
  currentUserId: string;
  existingAnnotation?: Annotation;
  onSubmit?: (annotation: Annotation) => Promise<void>;
  onDelete?: (messageId: string) => void;
}

// Performative options
const PERFORMATIVES: PerformativeOption[] = [
  { value: 'inform', label: 'Inform', description: 'Share information' },
  { value: 'propose', label: 'Propose', description: 'Suggest a course of action' },
  { value: 'challenge', label: 'Challenge', description: 'Question or contest' },
  { value: 'affirm', label: 'Affirm', description: 'Express agreement' },
  { value: 'wonder', label: 'Wonder', description: 'Express curiosity' },
  { value: 'weave', label: 'Weave', description: 'Connect disparate threads' },
  { value: 'request', label: 'Request', description: 'Ask for something' },
  { value: 'commit', label: 'Commit', description: 'Make a commitment' },
  { value: 'remember', label: 'Remember', description: 'Reference past context' },
];

// Affect stance options
const AFFECT_STANCES: AffectStance[] = [
  { value: 'warm', label: 'Warm' },
  { value: 'cautious', label: 'Cautious' },
  { value: 'curious', label: 'Curious' },
  { value: 'concerned', label: 'Concerned' },
  { value: 'resolute', label: 'Resolute' },
  { value: 'receptive', label: 'Receptive' },
  { value: 'urgent', label: 'Urgent' },
];

// Confidence level options
const CONFIDENCE_LEVELS: ConfidenceLevel[] = [
  { value: 0.2, label: 'Speculative', dots: 1 },
  { value: 0.45, label: 'Uncertain', dots: 2 },
  { value: 0.7, label: 'Confident', dots: 3 },
  { value: 0.9, label: 'Near-certain', dots: 4 },
];

function AnnotationButton({ onClick, disabled, title }: AnnotationButtonProps) {
  return (
    <button
      className="braid-annotation-btn"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Only the original sender can annotate' : title}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M10.5 1.5l2 2-8 8H2.5v-2l8-8z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M8.5 3.5l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span>Annotate</span>
    </button>
  );
}

function PerformativeSelector({ value, onChange, customValue, onCustomChange }: PerformativeSelectorProps) {
  const [showCustom, setShowCustom] = useState(!!customValue);

  return (
    <div className="braid-annotation-form__field">
      <label className="braid-annotation-form__label">Performative</label>
      <div className="braid-annotation-form__performative-grid">
        {PERFORMATIVES.map((perf) => (
          <button
            key={perf.value}
            type="button"
            className={`braid-annotation-form__performative-btn ${value === perf.value ? 'braid-annotation-form__performative-btn--selected' : ''}`}
            onClick={() => {
              onChange(perf.value);
              setShowCustom(false);
            }}
            title={perf.description}
          >
            {perf.label}
          </button>
        ))}
        <button
          type="button"
          className={`braid-annotation-form__performative-btn braid-annotation-form__performative-btn--custom ${showCustom ? 'braid-annotation-form__performative-btn--selected' : ''}`}
          onClick={() => {
            setShowCustom(true);
            onChange('');
          }}
        >
          Custom...
        </button>
      </div>
      {showCustom && (
        <input
          type="text"
          className="braid-annotation-form__input"
          placeholder="Enter custom performative"
          value={customValue || ''}
          onChange={(e) => onCustomChange(e.target.value)}
        />
      )}
    </div>
  );
}

function AffectSelector({ value, onChange }: AffectSelectorProps) {
  return (
    <div className="braid-annotation-form__field">
      <label className="braid-annotation-form__label">Affect Stance</label>
      <div className="braid-annotation-form__affect-grid">
        {AFFECT_STANCES.map((stance) => (
          <button
            key={stance.value}
            type="button"
            className={`braid-annotation-form__affect-btn ${value === stance.value ? 'braid-annotation-form__affect-btn--selected' : ''}`}
            onClick={() => onChange(value === stance.value ? null : stance.value)}
          >
            {stance.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConfidenceSelector({ value, onChange }: ConfidenceSelectorProps) {
  return (
    <div className="braid-annotation-form__field">
      <label className="braid-annotation-form__label">Epistemic Confidence</label>
      <div className="braid-annotation-form__confidence-grid">
        {CONFIDENCE_LEVELS.map((level) => (
          <button
            key={level.value}
            type="button"
            className={`braid-annotation-form__confidence-btn ${value === level.value ? 'braid-annotation-form__confidence-btn--selected' : ''}`}
            onClick={() => onChange(value === level.value ? null : level.value)}
          >
            <span className="braid-annotation-form__confidence-dots">
              {Array.from({ length: 4 }, (_, i) => (
                <span
                  key={i}
                  className={`braid-annotation-form__confidence-dot ${i < level.dots ? 'braid-annotation-form__confidence-dot--active' : ''}`}
                />
              ))}
            </span>
            <span className="braid-annotation-form__confidence-label">{level.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AnnotationForm({ messageId, onSubmit, onCancel, initialValues = {} }: AnnotationFormProps) {
  const [performative, setPerformative] = useState(initialValues.performative || '');
  const [customPerformative, setCustomPerformative] = useState(initialValues.custom_performative || '');
  const [affect, setAffect] = useState<string | null>(initialValues.affect?.stance || null);
  const [confidence, setConfidence] = useState<number | null>(initialValues.confidence?.epistemic || null);
  const [note, setNote] = useState(initialValues.note || '');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    const annotation: Annotation = {
      message_id: messageId,
      performative: customPerformative || performative || null,
      is_custom_performative: !!customPerformative,
      affect: affect ? { stance: affect } : null,
      confidence: confidence ? { epistemic: confidence } : null,
      note: note || null,
      timestamp: new Date().toISOString(),
    };

    try {
      await onSubmit(annotation);
    } finally {
      setSubmitting(false);
    }
  }, [messageId, performative, customPerformative, affect, confidence, note, onSubmit]);

  return (
    <form className="braid-annotation-form" onSubmit={handleSubmit}>
      <div className="braid-annotation-form__header">
        <span className="braid-annotation-form__title">Archaeological Annotation</span>
        <span className="braid-annotation-form__subtitle">
          Retrospective metadata for this message
        </span>
      </div>

      <div className="braid-annotation-form__body">
        <PerformativeSelector
          value={performative}
          onChange={setPerformative}
          customValue={customPerformative}
          onCustomChange={setCustomPerformative}
        />

        <AffectSelector
          value={affect}
          onChange={setAffect}
        />

        <ConfidenceSelector
          value={confidence}
          onChange={setConfidence}
        />

        <div className="braid-annotation-form__field">
          <label className="braid-annotation-form__label">Annotation Note</label>
          <textarea
            className="braid-annotation-form__textarea"
            placeholder="Add context about this message's role in the conversation..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
        </div>
      </div>

      <div className="braid-annotation-form__footer">
        <button
          type="button"
          className="braid-annotation-form__btn braid-annotation-form__btn--cancel"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="braid-annotation-form__btn braid-annotation-form__btn--submit"
          disabled={submitting}
        >
          {submitting ? 'Saving...' : 'Save Annotation'}
        </button>
      </div>
    </form>
  );
}

/**
 * BraidArchaeologicalAnnotation - Main component.
 */
export function BraidArchaeologicalAnnotation({
  messageId,
  senderId,
  currentUserId,
  existingAnnotation,
  onSubmit,
  onDelete,
}: BraidArchaeologicalAnnotationProps) {
  const [isFormOpen, setIsFormOpen] = useState(false);

  const canAnnotate = senderId === currentUserId;

  const handleSubmit = useCallback(async (annotation: Annotation) => {
    await onSubmit?.(annotation);
    setIsFormOpen(false);
  }, [onSubmit]);

  if (isFormOpen) {
    return (
      <AnnotationForm
        messageId={messageId}
        onSubmit={handleSubmit}
        onCancel={() => setIsFormOpen(false)}
        initialValues={existingAnnotation}
      />
    );
  }

  // Show existing annotation summary
  if (existingAnnotation) {
    return (
      <div className="braid-archaeological-annotation">
        <div className="braid-archaeological-annotation__existing">
          <span className="braid-archaeological-annotation__label">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M9 1l2 2-7 7H2V8l7-7z" stroke="currentColor" strokeWidth="1" />
            </svg>
            Annotated
          </span>
          {existingAnnotation.performative && (
            <span className="braid-archaeological-annotation__performative">
              {existingAnnotation.performative}
            </span>
          )}
          {existingAnnotation.affect?.stance && (
            <span className="braid-archaeological-annotation__affect">
              {existingAnnotation.affect.stance}
            </span>
          )}
          {canAnnotate && (
            <div className="braid-archaeological-annotation__actions">
              <button
                className="braid-archaeological-annotation__edit"
                onClick={() => setIsFormOpen(true)}
                title="Edit annotation"
              >
                Edit
              </button>
              {onDelete && (
                <button
                  className="braid-archaeological-annotation__delete"
                  onClick={() => onDelete(messageId)}
                  title="Delete annotation"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
        {existingAnnotation.note && (
          <div className="braid-archaeological-annotation__note">
            {existingAnnotation.note}
          </div>
        )}
      </div>
    );
  }

  // Show annotate button
  return (
    <div className="braid-archaeological-annotation">
      <AnnotationButton
        onClick={() => setIsFormOpen(true)}
        disabled={!canAnnotate}
        title="Add retrospective annotation"
      />
    </div>
  );
}
