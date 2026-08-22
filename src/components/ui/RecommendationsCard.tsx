import { Lightbulb } from 'lucide-react';
import ActionButton from './ActionButton';
import SectionTitle from './SectionTitle';
import type { Recommendation } from '../../lib/recommendations';
import { cn } from '../../lib/utils';

/** Convergence-value recommendations for the current step — collapsed into
 * a single card so it reads as guidance, not another row of inputs. Renders
 * nothing if every recommendation already checks out, so a well-set-up case
 * doesn't carry a permanently-visible "everything is fine" card. */
export default function RecommendationsCard({
  title = 'Recommended for convergence',
  items,
  note,
}: {
  title?: string;
  items: Recommendation[];
  note?: string | null;
}) {
  const suggestions = items.filter((r) => r.status === 'suggest');
  if (suggestions.length === 0 && !note) return null;

  return (
    <div className="mb-3.5 rounded-md border border-accent/25 bg-accent/[0.04] p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Lightbulb size={12} strokeWidth={1.9} className="text-accent" />
        <SectionTitle className="mb-0 text-accent/80">{title}</SectionTitle>
      </div>

      {suggestions.map((r) => (
        <div key={r.id} className="mb-2 last:mb-0">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-tiny text-dim2">{r.label}</span>
            <span className="font-mono text-2xs text-mute3 line-through">{r.current}</span>
            <span className="font-mono text-2xs font-semibold text-accent">{r.recommended}</span>
            {r.apply ? (
              <ActionButton size="sm" variant="outline" className="!px-2 !py-1 !text-2xs" onClick={r.apply}>
                Apply
              </ActionButton>
            ) : null}
          </div>
          <div className="mt-1 text-xxs leading-relaxed text-mute3">{r.reason}</div>
        </div>
      ))}

      {note ? (
        <div className={cn('text-xxs leading-relaxed text-mute3', suggestions.length > 0 && 'mt-2.5 border-t border-accent/15 pt-2.5')}>
          {note}
        </div>
      ) : null}
    </div>
  );
}
