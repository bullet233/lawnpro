import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, RefreshCcw, FileText } from 'lucide-react';
import { getDaysSince } from '../../utils/dateUtils';
import { getSettings } from '../../db/settings';
import { parseLawnSizeToSqFt } from '../../utils/parseLawnSize';
import { useServiceMode } from '../ServiceProvider';

// Does a service belong to the currently active division? Mirrors the
// name/id heuristics used in CustomersList / WeeklyScheduler.
function serviceMatchesMode(svc, mode) {
  const n = (svc.name || '').toLowerCase();
  if (mode === 'fertilizer') {
    return svc.id === 's3' || n.includes('fert') || n.includes('spray') || n.includes('weed') || n.includes('chem');
  }
  return svc.id === 's1' || n.includes('mow') || n.includes('cut') || n.includes('yard');
}

function FieldLabel({ color, children }) {
  return (
    <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color, marginBottom: '0.15rem' }}>
      {children}
    </div>
  );
}

export default function CustomerDetailsDropdown({ customer, allVisits, globalPace, darkTheme = false }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { activeMode } = useServiceMode();

  const { lastVisitDate, daysSinceStr, paceStr, scheduledStr, jobPrice, crossServiceStr, notes } = useMemo(() => {
    if (!customer) return {};

    // 1. Last Visit & Pace (average duration of past visits)
    let lastDate = null;
    let avgDuration = null;
    if (allVisits) {
      const custVisits = allVisits.filter(v => v.customerId === customer.id && v.status === 'completed');
      if (custVisits.length > 0) {
        custVisits.sort((a, b) => b.exitTime - a.exitTime);
        lastDate = custVisits[0].exitTime;
        const validDurations = custVisits.filter(v => v.durationSecs && v.durationSecs >= 60).map(v => v.durationSecs);
        if (validDurations.length > 0) {
          avgDuration = validDurations.reduce((a, b) => a + b, 0) / validDurations.length;
        }
      }
    }
    // Pace fallback from lawn size + global pace when there's no history.
    if (!avgDuration && customer.lawnSize && globalPace) {
      const sqft = parseLawnSizeToSqFt(customer.lawnSize);
      if (sqft) avgDuration = Math.max(300, Math.round((sqft / globalPace) * 60));
    }
    const paceStr = avgDuration ? `~${Math.round(avgDuration / 60)} min` : 'No data';

    // 2. Days since string
    let daysSinceStr = 'Never';
    if (lastDate) {
      const days = getDaysSince(lastDate);
      daysSinceStr = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
    }

    // 3. Scheduled service(s) + revenue — only the active division's service(s).
    const settings = getSettings();
    const defaultServices = settings?.defaultServices || [];
    const activeServices = customer.services?.filter(s => s.active) || [];
    let scheduled = activeServices.filter(s => serviceMatchesMode(s, activeMode));
    if (scheduled.length === 0) scheduled = activeServices; // safety net
    const scheduledStr = scheduled
      .map(s => s.name || defaultServices.find(d => d.id === s.id)?.name || 'Service')
      .join(', ') || 'Service';
    const jobPrice = scheduled.reduce((sum, s) => sum + (Number(s.price) || 0), 0);

    // 4. Cross-service history (the *other* division's last visit).
    let crossServiceStr = null;
    if (allVisits) {
      const crossMode = activeMode === 'mowing' ? 'fertilizer' : 'mowing';
      const custVisits = allVisits.filter(v => v.customerId === customer.id && v.status === 'completed');
      const crossVisits = custVisits.filter(v => {
        if (v.division) return v.division === crossMode;
        const svcIds = v.appliedServices || [];
        if (crossMode === 'mowing') {
          const mowIds = defaultServices.filter(s => s.category === 'Mowing' || s.id === 's1').map(s => s.id);
          return svcIds.length === 0 || svcIds.some(id => mowIds.includes(id));
        }
        const fertIds = defaultServices.filter(s => s.category === 'Fertilizer' || s.id === 's3').map(s => s.id);
        return svcIds.some(id => fertIds.includes(id));
      });
      const verb = crossMode === 'mowing' ? 'Mowed' : 'Fertilized';
      if (crossVisits.length > 0) {
        crossVisits.sort((a, b) => b.exitTime - a.exitTime);
        const d = getDaysSince(crossVisits[0].exitTime);
        const t = d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
        crossServiceStr = `Last ${verb.toLowerCase()} ${t}`;
      } else {
        crossServiceStr = `Never ${verb.toLowerCase()}`;
      }
    }

    return {
      lastVisitDate: lastDate,
      daysSinceStr,
      paceStr,
      scheduledStr,
      jobPrice,
      crossServiceStr,
      notes: customer.notes || ''
    };
  }, [customer, allVisits, globalPace, activeMode]);

  if (!customer) return null;

  // darkTheme=true → light surface, dark text (Next Job card).
  // darkTheme=false → dark/translucent surface, light text (Live timer panel).
  const textColor = darkTheme ? 'var(--color-text-main)' : 'rgba(255,255,255,0.95)';
  const mutedColor = darkTheme ? 'var(--color-text-muted)' : 'rgba(255,255,255,0.6)';
  const labelColor = darkTheme ? 'var(--color-text-muted)' : 'rgba(255,255,255,0.55)';
  const accentColor = darkTheme ? 'var(--color-primary)' : '#fff';
  const bgColor = darkTheme ? 'var(--color-bg-main)' : 'rgba(0,0,0,0.18)';
  const dividerColor = darkTheme ? 'var(--color-border)' : 'rgba(255,255,255,0.12)';
  const noteBg = darkTheme ? 'rgba(245,158,11,0.12)' : 'rgba(0,0,0,0.2)';
  const noteBorder = darkTheme ? 'rgba(245,158,11,0.35)' : 'rgba(252,211,77,0.3)';
  const noteText = darkTheme ? '#b45309' : '#fcd34d';

  const handleColor = darkTheme ? 'var(--color-border)' : 'rgba(255,255,255,0.45)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Drawer content — revealed above the handle when pulled open */}
      {isExpanded && (
        <div className="animate-fade-in" style={{ background: bgColor, borderRadius: 'var(--radius-md)', padding: '0.9rem', marginBottom: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.9rem', color: textColor }}>

          {/* Headline: scheduled service + its revenue */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '0.75rem' }}>
            <div style={{ minWidth: 0 }}>
              <FieldLabel color={labelColor}>Scheduled</FieldLabel>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, lineHeight: 1.2 }}>{scheduledStr}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <FieldLabel color={labelColor}>Revenue</FieldLabel>
              <div style={{ fontSize: '1.3rem', fontWeight: 800, color: accentColor, lineHeight: 1 }}>${jobPrice.toFixed(2)}</div>
            </div>
          </div>

          <div style={{ height: 1, background: dividerColor }} />

          {/* Last visit + average time, side by side */}
          <div style={{ display: 'flex', gap: '2rem' }}>
            <div>
              <FieldLabel color={labelColor}>Last Visit</FieldLabel>
              <div style={{ fontSize: '1rem', fontWeight: 600, lineHeight: 1.2 }}>{daysSinceStr}</div>
              {lastVisitDate && (
                <div style={{ fontSize: '0.75rem', color: mutedColor }}>
                  {new Date(lastVisitDate).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </div>
              )}
            </div>
            <div>
              <FieldLabel color={labelColor}>Avg Time</FieldLabel>
              <div style={{ fontSize: '1rem', fontWeight: 600, lineHeight: 1.2 }}>{paceStr}</div>
            </div>
          </div>

          {crossServiceStr && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem', color: mutedColor }}>
              <RefreshCcw size={13} style={{ flexShrink: 0 }} />
              {crossServiceStr}
            </div>
          )}

          {notes && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.6rem 0.7rem', borderRadius: 'var(--radius-sm)', background: noteBg, border: `1px solid ${noteBorder}` }}>
              <FileText size={14} style={{ marginTop: '2px', flexShrink: 0, color: noteText }} />
              <div style={{ fontSize: '0.85rem', lineHeight: 1.4, color: noteText }}>{notes}</div>
            </div>
          )}
        </div>
      )}

      {/* Grab handle at the card's bottom edge — pull down to reveal */}
      <button
        onClick={(e) => { e.stopPropagation(); setIsExpanded(v => !v); }}
        aria-label={isExpanded ? 'Hide customer details' : 'Show customer details'}
        style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.5rem 0 0.1rem', color: mutedColor }}
      >
        <span style={{ width: '40px', height: '5px', borderRadius: '3px', background: handleColor }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.3px' }}>
          {isExpanded ? <>Hide details <ChevronUp size={13} /></> : <>Pull for details <ChevronDown size={13} /></>}
        </span>
      </button>
    </div>
  );
}
