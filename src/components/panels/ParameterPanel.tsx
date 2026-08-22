import { useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import GeometryPanel from './GeometryPanel';
import RegionsPanel from './RegionsPanel';
import CasePanel from './CasePanel';
import MeshSolvePanel from './MeshSolvePanel';
import ResultsPanel from './ResultsPanel';
import ScaleUpPanel from './ScaleUpPanel';
import ExplorePanel from './ExplorePanel';
import { useAppStore } from '../../store/useAppStore';

const PANELS = [GeometryPanel, RegionsPanel, CasePanel, MeshSolvePanel, ResultsPanel, ScaleUpPanel, ExplorePanel];

/** Slim, collapsible, drag-resizable parameter panel docked to the right of the viewport. */
export default function ParameterPanel() {
  const step = useAppStore((s) => s.step);
  const panelWidth = useAppStore((s) => s.panelWidth);
  const setPanelWidth = useAppStore((s) => s.setPanelWidth);
  const Panel = PANELS[step] ?? GeometryPanel;
  const dragStart = useRef<{ x: number; width: number } | null>(null);

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragStart.current = { x: e.clientX, width: panelWidth };
      const onMove = (ev: PointerEvent) => {
        if (!dragStart.current) return;
        setPanelWidth(dragStart.current.width - (ev.clientX - dragStart.current.x));
      };
      const onUp = () => {
        dragStart.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [panelWidth, setPanelWidth],
  );

  return (
    <aside className="relative min-h-0 min-w-0 overflow-y-auto overflow-x-hidden border-l border-line bg-panel">
      <div
        onPointerDown={onResizePointerDown}
        title="Drag to resize"
        className="absolute left-0 top-0 z-10 h-full w-2 -translate-x-1/2 cursor-col-resize select-none hover:bg-accent/20 active:bg-accent/30"
      />
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -4 }}
          transition={{ duration: 0.14 }}
        >
          <Panel />
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}
