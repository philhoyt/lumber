/** Header buttons, settings controls and keyboard shortcuts. */
import { sampleWorkbench } from '../sample';
import { parseDocument, type Store } from '../store';
import type { LumberScene } from '../scene';
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
  $('bNew').onclick = () => {
    if (!store.parts.length || confirm('Clear the model?')) store.replaceParts([]);
  };
  $('bSample').onclick = () => {
    if (!store.parts.length || confirm('Replace the model with the sample workbench?'))
      store.replaceParts(sampleWorkbench());
  };
  $('bSave').onclick = () =>
    download('lumber-model.json', JSON.stringify(store.toDocument(), null, 1), 'application/json');
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
  $('bFocus').onclick = () => togglePanels();
}

export function togglePanels(): void {
  $('app').classList.toggle('focus');
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
    store.addPart(id, [snap(g[0]), 0, snap(g[2])]);
  });
}

export function wireKeyboard(store: Store): void {
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    const k = e.key.toLowerCase();
    const step = store.settings.grid || 0.0625;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') (e.shiftKey ? store.redo : store.undo).call(store);
    else if (mod && k === 'y') store.redo();
    else if (mod && k === 'd') store.duplicateSelected();
    else if (mod && k === 'a') store.select(store.parts.map((p) => p.id));
    else if (e.key === 'Delete' || e.key === 'Backspace') store.deleteSelected();
    else if (e.key === 'Escape') store.select([]);
    else if (e.key === 'Tab') togglePanels();
    else if (k === 'r') store.rotateSelected('y');
    else if (k === 't') store.rotateSelected('x');
    else if (k === 'f') store.rotateSelected('z');
    else if (e.key === 'ArrowLeft') store.nudge([-step, 0, 0]);
    else if (e.key === 'ArrowRight') store.nudge([step, 0, 0]);
    else if (e.key === 'ArrowUp') store.nudge([0, 0, -step]);
    else if (e.key === 'ArrowDown') store.nudge([0, 0, step]);
    else if (e.key === 'PageUp') store.nudge([0, step, 0]);
    else if (e.key === 'PageDown') store.nudge([0, -step, 0]);
    else return;
    e.preventDefault();
  });
}
