import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Search, Star, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SearchableOption {
  value: string;
  label: string;
  /** User-saved material — gets its own section up top and a delete affordance. */
  custom?: boolean;
}

interface SearchableSelectProps {
  value: string;
  options: SearchableOption[];
  favorites: string[];
  recents: string[];
  onChange: (value: string) => void;
  onToggleFavorite: (value: string) => void;
  onDelete?: (value: string) => void;
  className?: string;
}

/** Material picker: search box, favorites and recently-used, on top of the full list. */
export default function SearchableSelect({
  value,
  options,
  favorites,
  recents,
  onChange,
  onToggleFavorite,
  onDelete,
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const byKey = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const current = byKey.get(value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const customList = filtered.filter((o) => o.custom);
  const favList = filtered.filter((o) => favorites.includes(o.value) && !o.custom);
  const recentList = recents
    .map((k) => byKey.get(k))
    .filter((o): o is SearchableOption => Boolean(o) && !o?.custom && filtered.includes(o as SearchableOption));
  const rest = filtered.filter((o) => !favorites.includes(o.value) && !o.custom);

  const row = (o: SearchableOption) => (
    <div
      key={o.value}
      className="flex items-center gap-1.5 rounded px-1.5 py-1.5 hover:bg-white/[0.06]"
    >
      <button
        type="button"
        onClick={() => {
          onChange(o.value);
          setOpen(false);
          setQuery('');
        }}
        className={cn('flex-1 truncate text-left text-tiny', o.value === value ? 'text-accent' : 'text-ink2')}
      >
        {o.label}
      </button>
      {o.custom && onDelete ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm('Delete saved material "' + o.label + '"?')) onDelete(o.value);
          }}
          className="text-mute2 hover:text-bad"
          title="Delete saved material"
          aria-label={'Delete saved material ' + o.label}
        >
          <Trash2 size={11} strokeWidth={1.8} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onToggleFavorite(o.value)}
          className="text-mute2 hover:text-warn"
          title="Favourite"
          aria-label={(favorites.includes(o.value) ? 'Unfavourite ' : 'Favourite ') + o.label}
        >
          <Star size={11} strokeWidth={1.8} fill={favorites.includes(o.value) ? 'currentColor' : 'none'} />
        </button>
      )}
    </div>
  );

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded border border-line2 bg-field px-1.5 py-1.5 text-left text-tiny text-ink2 outline-none transition-colors duration-120 hover:border-white/20"
      >
        <span className="flex-1 truncate">{current?.label ?? value}</span>
        <ChevronDown size={11} strokeWidth={1.8} className="text-mute2" />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.13 }}
            className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-[280px] overflow-y-auto rounded-md border border-line2 bg-card p-1.5 shadow-modal"
          >
            <div className="mb-1.5 flex items-center gap-1.5 rounded border border-line2 bg-field px-1.5 py-1">
              <Search size={11} strokeWidth={1.8} className="text-mute2" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search materials…"
                className="w-full bg-transparent text-tiny text-ink outline-none"
              />
            </div>
            {customList.length > 0 ? (
              <>
                <div className="px-1.5 pb-0.5 pt-1 font-mono text-2xs uppercase tracking-[0.06em] text-mute3">Your materials</div>
                {customList.map(row)}
              </>
            ) : null}
            {favList.length > 0 ? (
              <>
                <div className="px-1.5 pb-0.5 pt-1 font-mono text-2xs uppercase tracking-[0.06em] text-mute3">Favourites</div>
                {favList.map(row)}
              </>
            ) : null}
            {recentList.length > 0 ? (
              <>
                <div className="px-1.5 pb-0.5 pt-1.5 font-mono text-2xs uppercase tracking-[0.06em] text-mute3">Recent</div>
                {recentList.map(row)}
              </>
            ) : null}
            <div className="px-1.5 pb-0.5 pt-1.5 font-mono text-2xs uppercase tracking-[0.06em] text-mute3">All</div>
            {rest.length > 0 ? rest.map(row) : <div className="px-1.5 py-2 text-2xs text-mute3">No matches</div>}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
