import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CornerDownLeft, Search } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useTasks } from '../hooks/useTasks';
import { useSolver } from '../hooks/useSolver';
import { WORKFLOW_STEPS } from '../lib/presets';

interface Command {
  id: string;
  label: string;
  group: string;
  keywords?: string;
  run: () => void;
}

/** Cmd/Ctrl+K palette — fuzzy-filtered list of navigation and pipeline actions,
 *  keyboard-only end to end (arrows to move, Enter to run, Esc to close). */
export default function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const set = useAppStore((s) => s.set);
  const setStep = useAppStore((s) => s.setStep);
  const toggleFocusMode = useAppStore((s) => s.toggleFocusMode);
  const exportProjectFile = useAppStore((s) => s.exportProjectFile);
  const startNewCase = useAppStore((s) => s.startNewCase);
  const panelOpen = useAppStore((s) => s.panelOpen);
  const { runGenerate, runFill, runMesh } = useTasks();
  const solver = useSolver();

  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => set({ commandPaletteOpen: false });

  const commands = useMemo<Command[]>(
    () => [
      ...WORKFLOW_STEPS.map((label, i) => ({
        id: 'step-' + i,
        label: 'Go to ' + label,
        group: 'Navigate',
        run: () => setStep(i),
      })),
      { id: 'generate', label: 'Generate geometry', group: 'Pipeline', run: runGenerate },
      { id: 'fill', label: 'Fill wall & validate watertightness', group: 'Pipeline', keywords: 'validate mesh unlock', run: runFill },
      { id: 'mesh', label: 'Generate mesh', group: 'Pipeline', keywords: 'background surface refine', run: runMesh },
      { id: 'solve', label: 'Run solve', group: 'Pipeline', keywords: 'simulate cfd', run: solver.start },
      { id: 'cancel-solve', label: 'Cancel solve', group: 'Pipeline', run: solver.cancel },
      { id: 'save', label: 'Save case to disk', group: 'Project', keywords: 'export json', run: exportProjectFile },
      { id: 'new-case', label: 'Start new case', group: 'Project', keywords: 'reset clear blank', run: () => { if (window.confirm('Start a new case? Any unsaved changes are lost — use Save case to disk first if you want to keep them.')) startNewCase(); } },
      { id: 'focus', label: 'Toggle focus mode', group: 'View', keywords: 'maximize viewport', run: toggleFocusMode },
      { id: 'panel', label: panelOpen ? 'Collapse parameter panel' : 'Show parameter panel', group: 'View', run: () => set({ panelOpen: !panelOpen }) },
      { id: 'about', label: 'About this build', group: 'Help', run: () => set({ aboutOpen: true }) },
    ],
    [setStep, runGenerate, runFill, runMesh, solver.start, solver.cancel, exportProjectFile, startNewCase, toggleFocusMode, panelOpen, set],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => (c.label + ' ' + (c.keywords ?? '') + ' ' + c.group).toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        set({ commandPaletteOpen: !open });
        return;
      }
      if (!open) return;
      if (e.key === 'Escape') {
        close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[index];
        if (cmd) {
          close();
          cmd.run();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filtered, index]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
          className="absolute inset-0 z-50 grid place-items-start justify-center bg-base/70 pt-[14vh] backdrop-blur-[2px]"
        >
          <motion.div
            initial={{ scale: 0.97, y: -6, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.98, y: -4, opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="w-[440px] overflow-hidden rounded-lg border border-white/10 bg-card shadow-modal"
          >
            <div className="flex items-center gap-2 border-b border-line2 px-3 py-2.5">
              <Search size={13} strokeWidth={1.8} className="text-mute2" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a command…"
                className="w-full bg-transparent text-base2 text-ink outline-none placeholder:text-mute3"
              />
              <span className="rounded border border-line2 px-1.5 py-0.5 font-mono text-2xs text-mute3">esc</span>
            </div>
            <div className="max-h-[320px] overflow-y-auto p-1.5">
              {filtered.length === 0 ? (
                <div className="px-2.5 py-3 text-tiny text-mute3">No matching commands</div>
              ) : (
                filtered.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => {
                      close();
                      c.run();
                    }}
                    className={
                      'flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left transition-colors duration-100 ' +
                      (i === index ? 'bg-accent/15 text-ink' : 'text-dim hover:bg-white/[0.04]')
                    }
                  >
                    <span className="flex-1 truncate text-base2">{c.label}</span>
                    <span className="font-mono text-2xs uppercase tracking-[0.05em] text-mute3">{c.group}</span>
                    {i === index ? <CornerDownLeft size={11} strokeWidth={2} className="text-accent" /> : null}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
