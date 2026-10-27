import { Activity, ArrowLeft, AudioLines, Check, CheckCircle2, ChevronRight, PlugZap, Unplug, Volume2, X, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import type { MeterMode, ProbeGuideResult, ProbeGuideState } from '../../lib/probe-guide';
import { useUi } from './ui-context';
import './workspace.css';

export interface ProbeGuideHudProps {
  probeGuide: ProbeGuideState | null;
  probeGuideResult?: ProbeGuideResult | null;
  onChoice?(choiceKey: string): void;
  onBack?(): void;
  onClose(): void;
}

/**
 * Mode badge per meter setting: an icon (lucide, or a text glyph where a glyph reads better than any icon — Ω for resistance) plus a
 * short label. "DC"/"AC"/"Ω"/"A" are kept as literal unit-style abbreviations (same convention as "mm" elsewhere in the catalogs);
 * "Continuity" goes through the catalog like every other user-facing word in this component.
 */
const MODE_BADGE: Record<MeterMode, { icon: ReactNode; label: string; continuity?: true }> = {
  V_DC: { icon: <Zap size={20} />, label: 'V DC' },
  V_AC: { icon: <AudioLines size={20} />, label: 'V AC' },
  OHM: { icon: <span aria-hidden="true" className="probe-glyph">Ω</span>, label: 'Ω' },
  CONTINUITY: { icon: <Volume2 size={20} />, label: '', continuity: true },
  A_DC: { icon: <Activity size={20} />, label: 'A DC' },
};

/**
 * Voltage/current modes only read something with the board powered; resistance/continuity modes need the board powered OFF (a live
 * rail reads wrong and can damage the meter or mislead the result). Shown as its own loud badge, since a beginner has no other way
 * to tell from "DC 20" alone whether the adapter/battery should be connected right now.
 */
const POWER_STATE: Record<MeterMode, 'on' | 'off'> = { V_DC: 'on', V_AC: 'on', A_DC: 'on', OHM: 'off', CONTINUITY: 'off' };

/** The on-screen Probe Guide panel: current step's meter mode/range, expected reading, probe lead legend, instruction and choices. */
export function ProbeGuideHud(props: ProbeGuideHudProps): ReactNode {
  const { probeGuide, probeGuideResult, onChoice, onBack, onClose } = props;
  const { t } = useUi();

  if (!probeGuide) {
    if (!probeGuideResult) return null;
    return (
      <div className="probe-hud probe-hud--verdict" data-testid="probe-guide-hud">
        <div className="probe-hud-head">
          <div className="probe-hud-title" title={probeGuideResult.guideTitle}>{probeGuideResult.guideTitle}</div>
          <button type="button" className="probe-hud-close" aria-label={t('probe.close')} title={t('probe.close')} onClick={onClose}><X size={16} /></button>
        </div>
        <div className="probe-hud-verdict-card">
          <div className="probe-hud-verdict-head">
            <CheckCircle2 size={18} />
            <span className="probe-hud-tag">{t('probe.verdict')}</span>
          </div>
          <strong className="probe-hud-verdict-text">{probeGuideResult.verdict ?? probeGuideResult.choiceLabel}</strong>
          {probeGuideResult.verdict && (
            <div className="probe-hud-verdict-choice">
              <span className="probe-hud-key">{probeGuideResult.choiceKey}</span>
              <span>{probeGuideResult.choiceLabel}</span>
            </div>
          )}
        </div>
        <button type="button" className="probe-hud-done" onClick={onClose}>
          <Check size={15} />
          <span>{t('probe.done')}</span>
        </button>
      </div>
    );
  }

  const step = probeGuide.guide.steps[probeGuide.currentStepId];
  if (!step) return null;
  const badge = MODE_BADGE[step.mode.type];
  const power = POWER_STATE[step.mode.type];
  const stepIndex = probeGuide.history.length + 1;
  const canStepBack = probeGuide.history.length > 0 && !!onBack;
  const showImplicitGnd = step.probes.length === 1 && step.probes[0]?.color === 'red';

  return (
    <div className="probe-hud" data-testid="probe-guide-hud">
      <div className="probe-hud-top">
        <span className="probe-hud-step-badge">{t('probe.stepNumber', { step: stepIndex })}</span>
        <div className="probe-hud-title" title={probeGuide.guide.title}>{probeGuide.guide.title}</div>
        {canStepBack && (
          <button type="button" className="probe-hud-nav-btn" aria-label={t('probe.back')} title={t('probe.back')} onClick={onBack}>
            <ArrowLeft size={15} />
          </button>
        )}
        <button type="button" className="probe-hud-close" aria-label={t('probe.close')} title={t('probe.close')} onClick={onClose}><X size={16} /></button>
      </div>

      <div className={`probe-hud-power probe-hud-power--${power}`} data-testid="probe-guide-power">
        {power === 'on' ? <PlugZap size={15} /> : <Unplug size={15} />}
        <span>{power === 'on' ? t('probe.powerOn') : t('probe.powerOff')}</span>
      </div>

      <div className="probe-hud-readout">
        <div className="probe-hud-head">
          <div className="probe-hud-mode">
            {badge.icon}
            <div className="probe-hud-mode-stack">
              <span className="probe-hud-mode-label">{badge.continuity ? t('probe.continuity') : badge.label}</span>
              <span className="probe-hud-range">{t('probe.range', { range: step.mode.range })}</span>
            </div>
          </div>
        </div>
        <div className="probe-hud-expected">
          <span className="probe-hud-tag">{t('probe.expected')}</span>
          <strong className="mono">{step.expected}</strong>
        </div>
      </div>

      <div className="probe-hud-probes">
        {step.probes.map((probe, idx) => (
          <div key={`${probe.color}-${probe.pinId ?? probe.componentId}-${idx}`} className={`probe-lead probe-lead--${probe.color}`}>
            <span className="probe-lead-dot" aria-hidden="true">{probe.color === 'red' ? '+' : '−'}</span>
            <div className="probe-lead-text">
              <span className="probe-lead-role">{probe.color === 'red' ? t('probe.redLead') : t('probe.blueLead')}</span>
              <strong className="probe-lead-target mono">{probe.label ?? probe.pinId ?? probe.componentId}</strong>
            </div>
          </div>
        ))}
        {showImplicitGnd && (
          <div className="probe-lead probe-lead--blue probe-lead--implicit">
            <span className="probe-lead-dot" aria-hidden="true">−</span>
            <div className="probe-lead-text">
              <span className="probe-lead-role">{t('probe.blueLead')}</span>
              <strong className="probe-lead-target mono">{t('probe.referenceGnd')}</strong>
            </div>
          </div>
        )}
      </div>

      <p className="probe-hud-instruction">{step.instruction}</p>

      <ol className="probe-hud-choices">
        {step.choices.map(choice => (
          <li key={choice.key} className="probe-hud-choice-item">
            <button
              type="button"
              className={`probe-hud-choice${choice.next === null ? ' probe-hud-choice--terminal' : ''}`}
              onClick={() => onChoice?.(choice.key)}
            >
              <span className="probe-hud-key mono">{choice.key}</span>
              <span className="probe-hud-choice-label">{choice.label}</span>
              <span className="probe-hud-choice-arrow" aria-hidden="true">
                {choice.next === null ? <CheckCircle2 size={15} /> : <ChevronRight size={15} />}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
