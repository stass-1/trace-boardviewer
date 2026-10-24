import { Activity, AudioLines, Volume2, X, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import type { MeterMode, ProbeGuideState } from '../../lib/probe-guide';
import { useUi } from './ui-context';
import './workspace.css';

export interface ProbeGuideHudProps {
  probeGuide: ProbeGuideState | null;
  onClose(): void;
}

/**
 * Mode badge per meter setting: an icon (lucide, or a text glyph where a glyph reads better than any icon — Ω for resistance) plus a
 * short label. "DC"/"AC"/"Ω"/"A" are kept as literal unit-style abbreviations (same convention as "mm" elsewhere in the catalogs);
 * "Continuity" goes through the catalog like every other user-facing word in this component.
 */
const MODE_BADGE: Record<MeterMode, { icon: ReactNode; label: string; continuity?: true }> = {
  V_DC: { icon: <Zap size={22} />, label: 'DC' },
  V_AC: { icon: <AudioLines size={22} />, label: 'AC' },
  OHM: { icon: <span aria-hidden="true" className="probe-glyph">Ω</span>, label: 'Ω' },
  CONTINUITY: { icon: <Volume2 size={22} />, label: '', continuity: true },
  A_DC: { icon: <Activity size={22} />, label: 'A' },
};

/** The on-screen Probe Guide panel: current step's meter mode/range, expected reading, instruction and numbered choices. */
export function ProbeGuideHud(props: ProbeGuideHudProps): ReactNode {
  const { probeGuide, onClose } = props;
  const { t } = useUi();
  if (!probeGuide) return null;
  const step = probeGuide.guide.steps[probeGuide.currentStepId];
  if (!step) return null;
  const badge = MODE_BADGE[step.mode.type];

  return (
    <div className="probe-hud" data-testid="probe-guide-hud">
      <div className="probe-hud-head">
        <div className="probe-hud-mode">
          {badge.icon}
          <span className="probe-hud-mode-label">{badge.continuity ? t('probe.continuity') : badge.label}</span>
          <span className="probe-hud-range">{t('probe.range', { range: step.mode.range })}</span>
        </div>
        <button type="button" className="probe-hud-close" aria-label={t('probe.close')} onClick={onClose}><X size={16} /></button>
      </div>
      <div className="probe-hud-title">{probeGuide.guide.title}</div>
      <div className="probe-hud-expected"><span className="probe-hud-tag">{t('probe.expected')}</span><strong>{step.expected}</strong></div>
      <p className="probe-hud-instruction">{step.instruction}</p>
      <ol className="probe-hud-choices">
        {step.choices.map(choice => (
          <li key={choice.key} className="probe-hud-choice">
            <span className="probe-hud-key">{choice.key}</span>
            <span className="probe-hud-choice-label">{choice.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
