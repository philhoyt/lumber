/** Header buttons, settings controls, panel toggles and the Blender-style key map. */
import { MIN_LEN } from '../model';
import { groundOnGrid } from '../snap';
import {
  Download,
  FilePlus,
  FolderOpen,
  Link2,
  Moon,
  PanelLeft,
  PanelRight,
  PencilRuler,
  Printer,
  Redo2,
  Save,
  Settings2,
  Sun,
  Undo2,
} from 'lucide';
import type { ProjectManager } from '../projectManager';
import type { Store } from '../store';
import type { LumberScene, ViewName } from '../scene';
import { cutListCsv } from './cutlist';
import { $, download } from './dom';
import { setIcon } from './icons';
import { DRAG_TYPE } from './palette';
import { encodeShare, linkSize } from '../share';
import { currentTheme, toggleTheme, type Theme } from './theme';
import { beginMirror, mirrorKey } from './mirror';
import { toast } from './toast';
import { addStock } from './recent';

export interface AppActions {
  /** Shift+A: open the add-stock menu at the pointer. */
  addMenu(): void;
  /** Shift+R: array the selection by dragging, with the Part panel's spacing. */
  arrayDrag(): void;
  /** B: a piece of blocking between the two selected parallel parts. */
  blockBetween(): void;
  /** ? or F1: the key reference. */
  toggleHelp(): void;
  /** Close any overlay or menu; returns whether one was open. */
  closeOverlays(): boolean;
  onTheme(theme: Theme): void;
  /** Ctrl+O: the Projects dialog. */
  showProjects(): void;
  showDrawings(): void;
  trackpad(): boolean;
  setTrackpad(on: boolean): void;
}

export function wireHeader(store: Store, pm: ProjectManager, actions: AppActions): void {
  setIcon($('bNew'), FilePlus);
  setIcon($('bOpen'), FolderOpen);
  setIcon($('bSave'), Save);
  setIcon($('bUndo'), Undo2);
  setIcon($('bRedo'), Redo2);
  setIcon($('bCsv'), Download);
  setIcon($('bPrint'), Printer);
  setIcon($('bDrawings'), PencilRuler);
  setIcon($('bShare'), Link2);
  setIcon($('bPalette'), PanelLeft);
  setIcon($('bSide'), PanelRight);
  setIcon($('bStockEdit'), Settings2, 15);
  const themeBtn = $('bTheme');
  const showTheme = (t: Theme) => {
    setIcon(themeBtn, t === 'light' ? Moon : Sun);
    themeBtn.title = t === 'light' ? 'Switch to the dark theme' : 'Switch to the light theme';
  };
  showTheme(currentTheme());
  themeBtn.onclick = () => {
    const t = toggleTheme();
    showTheme(t);
    actions.onTheme(t);
  };

  $<HTMLSelectElement>('gridSel').addEventListener('change', (e) =>
    store.setSetting('grid', parseFloat((e.target as HTMLSelectElement).value)),
  );
  $<HTMLInputElement>('snapChk').addEventListener('change', (e) =>
    store.setSetting('snapParts', (e.target as HTMLInputElement).checked),
  );
  const trackChk = $<HTMLInputElement>('trackChk');
  trackChk.checked = actions.trackpad();
  trackChk.addEventListener('change', () => actions.setTrackpad(trackChk.checked));
  const undo = $<HTMLButtonElement>('bUndo');
  const redo = $<HTMLButtonElement>('bRedo');
  undo.onclick = () => store.undo();
  redo.onclick = () => store.redo();
  const syncHistory = () => {
    undo.disabled = !store.canUndo;
    redo.disabled = !store.canRedo;
  };
  store.subscribe(syncHistory);
  syncHistory();
  $('bNew').onclick = () => pm.newProject();
  $('bSample').onclick = () => pm.newFromSample();
  $('bSave').onclick = () => pm.exportCurrent(download);
  $('bOpen').onclick = () => actions.showProjects();
  wireProjectName(pm);
  $('bCsv').onclick = () => download('cut-list.csv', cutListCsv(store), 'text/csv');
  $('bPrint').onclick = () => window.print();
  $('bDrawings').onclick = () => actions.showDrawings();
  $('bShare').onclick = () => void shareLink(store, pm);
  $('bPalette').onclick = () => togglePanels('palette');
  $('bSide').onclick = () => togglePanels('side');
  syncPanelButtons();
}

/** Put a link carrying the current project on the clipboard, or show it to copy by hand. */
async function shareLink(store: Store, pm: ProjectManager): Promise<void> {
  pm.flush();
  const hash = await encodeShare(store.toDocument(), pm.current.name);
  const link = `${location.origin}${location.pathname}#${hash}`;
  try {
    await navigator.clipboard.writeText(link);
    toast(`Link copied (${linkSize(link)}). Anyone who opens it gets a copy of this project.`);
  } catch {
    // Clipboard refused (no permission or not a secure context): put it in the address bar.
    history.replaceState(null, '', `#${hash}`);
    toast(`Copy the link from the address bar (${linkSize(link)}).`);
  }
}

/** The project name in the header: click to rename in place; the footer shows save state. */
function wireProjectName(pm: ProjectManager): void {
  const btn = $<HTMLButtonElement>('projName');
  const saved = $('saved');
  const show = () => (btn.textContent = pm.current.name);
  pm.onProject = show;
  show();
  let last: 'saved' | 'saving' | 'error' = 'saved';
  const showStatus = () => {
    const folder = pm.folder?.state === 'ready' ? ` · ${pm.folder.folderName}` : '';
    saved.textContent =
      last === 'saved'
        ? `Saved${folder}`
        : last === 'saving'
          ? 'Saving…'
          : 'Not saved: storage is full';
    saved.classList.toggle('warn', last === 'error');
  };
  pm.onStatus = (s) => {
    last = s;
    showStatus();
  };
  if (pm.folder) {
    const prev = pm.folder.onChange;
    pm.folder.onChange = () => {
      prev?.();
      showStatus();
    };
  }
  btn.onclick = () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'proj-edit';
    input.value = pm.current.name;
    input.maxLength = 80;
    btn.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (ok) pm.rename(pm.current.id, input.value);
      input.replaceWith(btn);
      show();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
  };
}

/** T toggles the palette, N the side panel (Blender's T and N panels), Tab both. */
export function togglePanels(which: 'side' | 'palette' | 'both'): void {
  const app = $('app');
  if (which === 'both') {
    const on = !app.classList.contains('no-side') || !app.classList.contains('no-palette');
    app.classList.toggle('no-side', on);
    app.classList.toggle('no-palette', on);
  } else app.classList.toggle(which === 'side' ? 'no-side' : 'no-palette');
  syncPanelButtons();
}
function syncPanelButtons(): void {
  const app = $('app');
  $('bPalette').classList.toggle('on', !app.classList.contains('no-palette'));
  $('bSide').classList.toggle('on', !app.classList.contains('no-side'));
}

/** The Parts / Cut list tabs in the side panel. */
export function wireTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.tabs [data-tab]');
  tabs.forEach((b) =>
    b.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.toggle('on', x === b));
      document.querySelectorAll<HTMLElement>('#side .pane').forEach((p) => {
        p.hidden = p.id !== `tab-${b.dataset.tab}`;
      });
    }),
  );
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
    addStock(store, id, groundOnGrid(g, store.settings.grid));
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
/** Ctrl with the same keys pans, as in Blender: the view slides toward that side. */
const PAN_KEYS: Record<string, [number, number]> = {
  '4': [-1, 0],
  '6': [1, 0],
  '8': [0, 1],
  '2': [0, -1],
};

/** Whether a focused control holds nothing the user typed and has not yet applied. */
function fieldIsClean(t: HTMLElement): boolean {
  if (!(t instanceof HTMLInputElement) || t.type === 'checkbox') return t.tagName !== 'TEXTAREA';
  return t.dataset.was === undefined || t.dataset.was === t.value;
}

export function wireKeyboard(
  store: Store,
  scene: LumberScene,
  pm: ProjectManager,
  actions: AppActions,
): void {
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) {
      if (e.key === 'Escape') t.blur();
      // Undo in a field is the model's once what was typed has been applied (Enter leaves
      // the field focused); while there is uncommitted text it is the field's own.
      else if (mod && (k === 'z' || k === 'y') && fieldIsClean(t)) {
        if (k === 'y' || e.shiftKey) store.redo();
        else store.undo();
        e.preventDefault();
      }
      return;
    }
    if (scene.transforming) return; // the scene handles keys during G / R / S
    if (mirrorKey(e, store)) {
      e.preventDefault();
      return;
    }
    const step = store.settings.grid || MIN_LEN;
    const digit = e.code.startsWith('Numpad') ? e.code.slice(6) : e.code.replace('Digit', '');

    if (e.key === 'Escape') {
      if (scene.measuring) scene.endMeasure();
      else if (scene.centering) scene.endCenterBetween();
      else if (scene.fastening) scene.endFasten();
      else if (!actions.closeOverlays()) store.select([]);
    } else if (e.key === '?' || e.key === 'F1' || (e.shiftKey && e.code === 'Slash'))
      actions.toggleHelp();
    else if (mod && k === 'z') {
      if (e.shiftKey) store.redo();
      else store.undo();
    } else if (mod && k === 'y') store.redo();
    else if (mod && k === 's') pm.exportCurrent(download);
    else if (mod && k === 'o') actions.showProjects();
    else if (mod && k === 'd') store.duplicateSelected();
    else if (mod && k === 'm') beginMirror(store);
    else if (mod && k === 'g') {
      if (e.shiftKey) store.ungroupSelected();
      else store.groupSelected();
    } else if (mod && e.code === 'Space') togglePanels('both');
    else if (e.shiftKey && k === 'e') scene.toggleAssembly();
    else if (e.shiftKey && k === 'd') scene.duplicateAndGrab();
    else if (e.shiftKey && k === 'r') actions.arrayDrag();
    else if (e.shiftKey && k === 'a') actions.addMenu();
    else if (e.altKey && k === 'a') store.select([]);
    else if (e.altKey && k === 'h') store.unhideAll();
    else if (e.altKey && k === 'g') store.dropSelected();
    else if (k === 'a') store.selectAll();
    else if (k === 'g') scene.beginGrab();
    else if (k === 'r') scene.beginRotate();
    else if (k === 's') scene.beginSize();
    else if (k === 'h') store.hideSelected();
    else if (k === 'c') scene.beginCenterBetween(e.shiftKey ? 'space' : 'center');
    else if (k === 'b') actions.blockBetween();
    else if (k === 'm') scene.toggleMeasure();
    else if (k === 'f') scene.toggleFasten();
    else if (k === 'e') scene.toggleExplode();
    else if (k === 'd') scene.toggleDims();
    else if (k === 'n') togglePanels('side');
    else if (k === 't') togglePanels('palette');
    else if (k === 'x' || e.key === 'Delete') store.deleteSelected();
    else if (e.key === 'Tab') togglePanels('both');
    else if (e.key === '[') scene.stepAssembly(-1);
    else if (e.key === ']') scene.stepAssembly(1);
    else if (e.key === 'Home') scene.rig.setView('fit');
    else if (e.code === 'NumpadDecimal' || e.code === 'Period') scene.rig.setView('selected');
    else if (digit === '5') scene.rig.toggleProjection();
    else if (VIEW_KEYS[digit]) scene.rig.setView(VIEW_KEYS[digit][mod ? 1 : 0]);
    else if (digit === '9') scene.rig.flipView();
    else if (mod && PAN_KEYS[digit]) scene.rig.panStep(...PAN_KEYS[digit]);
    else if (ORBIT_KEYS[digit]) scene.rig.orbitStep(...ORBIT_KEYS[digit]);
    else if (!mod && (e.code === 'NumpadAdd' || e.key === '+' || e.key === '='))
      scene.rig.zoomStep(true);
    else if (!mod && (e.code === 'NumpadSubtract' || e.key === '-')) scene.rig.zoomStep(false);
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
