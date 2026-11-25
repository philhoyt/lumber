/** Header buttons, settings controls, view buttons and the Blender-style key map. */
import { sampleWorkbench } from '../sample';
import { parseDocument, type Store } from '../store';
import type { LumberScene, ViewName } from '../scene';
import { cutListCsv } from './cutlist';
import { $, download } from './dom';
import { DRAG_TYPE } from './palette';

export function wireHeader(store: Store): void {
  $<HTMLSelectElement>('gridSel').addEventListener('change', (e) =>
    store.setSetting('grid', parseFloat((e.target as HTMLSelectElement).value)),
  );
  $<HTMLInputElement>('snapChk').addEventListener('change', (e) =>
    store.setSetting('snapParts', (e.target as HTMLInputElement).checked),
  );
  $('bUndo').onclick = () => store.undo();
  $('bRedo').onclick = () => store.redo();
  $('bNew').onclick = () => newModel(store);
  $('bSample').onclick = () => {
    if (!store.parts.length || confirm('Replace the model with the sample workbench?'))
      store.replaceParts(sampleWorkbench());
  };
  $('bSave').onclick = () => saveModel(store);
  const fileIn = $<HTMLInputElement>('fileIn');
  $('bOpen').onclick = () => fileIn.click();
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    fileIn.value = '';
    if (!f) return;
    let doc = null;
    try {
      doc = parseDocument(JSON.parse(await f.text()));
    } catch {
      /* not JSON */
    }
    if (doc) store.loadDocument(doc);
    else alert('That file is not a Lumber model.');
  });
  $('bCsv').onclick = () => download('cut-list.csv', cutListCsv(store), 'text/csv');
  $('bPrint').onclick = () => window.print();
  $('bFocus').onclick = () => togglePanels('both');
}

function newModel(store: Store): void {
  if (!store.parts.length || confirm('Clear the model?')) store.replaceParts([]);
}
function saveModel(store: Store): void {
  download('lumber-model.json', JSON.stringify(store.toDocument(), null, 1), 'application/json');
}

/** N toggles the side panel, T the palette (Blender's N and T panels), Ctrl+Space both. */
export function togglePanels(which: 'side' | 'palette' | 'both'): void {
  const app = $('app');
  if (which === 'both') {
    const on = !app.classList.contains('no-side') || !app.classList.contains('no-palette');
    app.classList.toggle('no-side', on);
    app.classList.toggle('no-palette', on);
  } else app.classList.toggle(which === 'side' ? 'no-side' : 'no-palette');
}

export function wireViews(scene: LumberScene): void {
  document
    .querySelectorAll<HTMLButtonElement>('[data-view]')
    .forEach((b) => b.addEventListener('click', () => scene.setView(b.dataset.view as ViewName)));
}

export function wireDrop(viewport: HTMLElement, scene: LumberScene, store: Store): void {
  viewport.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    viewport.classList.add('dropping');
  });
  viewport.addEventListener('dragleave', () => viewport.classList.remove('dropping'));
  viewport.addEventListener('drop', (e) => {
    e.preventDefault();
    viewport.classList.remove('dropping');
    const id = e.dataTransfer?.getData(DRAG_TYPE);
    if (!id) return;
    const g = scene.groundPoint(e.clientX, e.clientY) ?? [0, 0, 0];
    const grid = store.settings.grid;
    const snap = (v: number) => (grid ? Math.round(v / grid) * grid : v);
    store.addPart(id, [snap(g[0]), snap(g[1]), 0]);
  });
}

/** Numpad views as in Blender; the top-row digits work the same for keyboards without one. */
const VIEW_KEYS: Record<string, [ViewName, ViewName]> = {
  // digit: [plain, with Ctrl]
  '1': ['front', 'back'],
  '3': ['right', 'left'],
  '7': ['top', 'bottom'],
};
const ORBIT_KEYS: Record<string, [number, number]> = {
  '4': [15, 0],
  '6': [-15, 0],
  '8': [0, 15],
  '2': [0, -15],
};

export function wireKeyboard(store: Store, scene: LumberScene): void {
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    if (scene.transforming) return; // the scene handles keys during G / R / S
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const step = store.settings.grid || 0.0625;
    const digit = e.code.startsWith('Numpad') ? e.code.slice(6) : e.code.replace('Digit', '');

    if (mod && k === 'z') (e.shiftKey ? store.redo : store.undo).call(store);
    else if (mod && k === 'y') store.redo();
    else if (mod && k === 's') saveModel(store);
    else if (mod && k === 'o') $('bOpen').click();
    else if (mod && k === 'd') store.duplicateSelected();
    else if (mod && e.code === 'Space') togglePanels('both');
    else if (e.shiftKey && k === 'd') scene.duplicateAndGrab();
    else if (e.altKey && k === 'a') store.select([]);
    else if (e.altKey && k === 'h') store.unhideAll();
    else if (e.altKey && k === 'g') store.dropSelected();
    else if (k === 'a') store.selectAll();
    else if (k === 'g') scene.beginGrab();
    else if (k === 'r') scene.beginRotate();
    else if (k === 's') scene.beginSize();
    else if (k === 'h') store.hideSelected();
    else if (k === 'n') togglePanels('side');
    else if (k === 't') togglePanels('palette');
    else if (k === 'x' || e.key === 'Delete') store.deleteSelected();
    else if (e.key === 'Escape') store.select([]);
    else if (e.key === 'Tab') togglePanels('both');
    else if (e.key === 'Home') scene.setView('fit');
    else if (e.code === 'NumpadDecimal' || e.code === 'Period') scene.setView('selected');
    else if (VIEW_KEYS[digit]) scene.setView(VIEW_KEYS[digit]![mod ? 1 : 0]);
    else if (ORBIT_KEYS[digit]) scene.orbitStep(...ORBIT_KEYS[digit]!);
    else if (e.key === 'ArrowLeft') store.nudge([-step, 0, 0]);
    else if (e.key === 'ArrowRight') store.nudge([step, 0, 0]);
    else if (e.key === 'ArrowUp') store.nudge([0, step, 0]);
    else if (e.key === 'ArrowDown') store.nudge([0, -step, 0]);
    else if (e.key === 'PageUp') store.nudge([0, 0, step]);
    else if (e.key === 'PageDown') store.nudge([0, 0, -step]);
    else return;
    e.preventDefault();
  });
}
