import './style.css';
import { LumberScene } from './scene';
import { Store } from './store';
import { CutlistPanel } from './ui/cutlist';
import { $ } from './ui/dom';
import { wireAssemblyBar } from './ui/assemblyBar';
import { wireExplodeBar } from './ui/explodeBar';
import { wireFastenBar } from './ui/fastenBar';
import { wireNavGizmo } from './ui/navGizmo';
import { wireSplitters } from './ui/splitters';
import { wireLengthFields } from './ui/fields';
import { togglePanels, wireDrop, wireHeader, wireKeyboard, wireTabs } from './ui/header';
import { DrawingsOverlay } from './ui/drawings';
import { HelpOverlay } from './ui/help';
import { buildListMenu, buildMenu, ContextMenu, menuTitle, stockItems } from './ui/menu';
import { OutlinerPanel } from './ui/outliner';
import { renderPalette } from './ui/palette';
import { PropsPanel } from './ui/props';
import { wireStatus } from './ui/status';
import { StockEditor } from './ui/stockEditor';
import { ProjectsDialog } from './ui/projectsDialog';
import { ProjectManager } from './projectManager';
import { ProjectStore } from './projects';
import { decodeShare } from './share';
import { beginMirror } from './ui/mirror';
import { toast } from './ui/toast';
import { browserPicker, FolderSync, idbHandleStore } from './folderSync';
import { initTheme, type Theme } from './ui/theme';
import { buildToolbar } from './ui/toolbar';
import { parseLen } from './units';

const theme = initTheme();
const store = new Store();
const menu = new ContextMenu();
const folder = new FolderSync(idbHandleStore, browserPicker);
const pm = new ProjectManager(store, new ProjectStore(localStorage), folder);
// A share link in the address bar: import it as a new project, then clear the hash so a
// refresh does not import it again.
if (/(^|[#&])m=/.test(location.hash)) {
  void decodeShare(location.hash).then((shared) => {
    history.replaceState(null, '', location.pathname + location.search);
    if (!shared) {
      toast('That link does not hold a Lumber model.');
      return;
    }
    pm.newProject(shared.name, shared.doc);
    toast(`Opened "${shared.name}" from the link as a new project.`);
  });
}
void folder.init();

const scene = new LumberScene($('viewport'), store);
scene.setTheme(theme);
const help = new HelpOverlay($('help'));
const drawings = new DrawingsOverlay(document.body, store, () => pm.current.name);
const stockEditor = new StockEditor(document.body, store);
const projectsDialog = new ProjectsDialog(document.body, pm);
$('bStockEdit').onclick = () => stockEditor.show();
const props = new PropsPanel(
  $('props'),
  store,
  () => scene.toggleFasten(),
  () => scene.beginCenterBetween(),
);
scene.onCenterBetween = (state, axis) => {
  if (state === 'start') toast('Center between: click the first part, in the view or the list.');
  else if (state === 'picked') toast('Now click the second part.');
  else if (state === 'done')
    toast(
      axis === undefined
        ? 'Those two sit on top of each other; nothing to center between.'
        : `Centered between them on ${'XYZ'[axis]}.`,
    );
};
wireFastenBar($('viewport'), store, scene);
wireExplodeBar($('viewport'), scene);
wireAssemblyBar($('viewport'), store, scene);
wireNavGizmo($('viewport'), scene);
wireSplitters($('viewport'));
renderPalette($('boards'), $('sheets'), $<HTMLInputElement>('palSearch'), store);
const outliner = new OutlinerPanel(
  $('outBody'),
  $('outCount'),
  $<HTMLInputElement>('outFilter'),
  store,
  scene,
);
outliner.onContextMenu = (x, y, target) => {
  // The row is selected by now, so the usual title fits; a hidden part is not selected.
  const part = target.kind === 'part' ? store.partById(target.id) : undefined;
  const title = part?.hidden ? part.name : menuTitle(store);
  menu.open(
    x,
    y,
    title,
    buildListMenu(target, store, scene, { rename: () => outliner.rename(target) }),
  );
};
new CutlistPanel($('cutBody'), store);
wireStatus($('stat'), $('hints'), $('overall'), store);
wireTabs();

const actions = {
  addMenu: () => {
    const [x, y] = scene.pointerPosition();
    menu.open(x, y, 'Add stock', [stockItems(scene.groundPoint(x, y), store)]);
  },
  toggleHelp: () => help.toggle(),
  closeOverlays: () => {
    if (help.open) {
      help.hide();
      return true;
    }
    if (drawings.open) {
      drawings.hide();
      return true;
    }
    if (menu.isOpen) {
      menu.close();
      return true;
    }
    if (stockEditor.open) {
      stockEditor.hide();
      return true;
    }
    if (projectsDialog.open) {
      projectsDialog.hide();
      return true;
    }
    return false;
  },
  onTheme: (t: Theme) => scene.setTheme(t),
  showProjects: () => projectsDialog.show(),
  arrayDrag: () => {
    if (!store.selected.size) return;
    // The Part panel's spacing and mode, when it shows them; 16" on centre otherwise.
    const spacing = parseLen(document.querySelector<HTMLInputElement>('#arrS')?.value);
    const mode = document.querySelector<HTMLSelectElement>('#arrMode')?.value;
    scene.beginArray({
      ...(spacing !== null && spacing > 0 ? { spacing } : {}),
      ...(mode === 'gap' || mode === 'center' ? { mode } : {}),
    });
  },
  showDrawings: () => drawings.toggle(),
  trackpad: () => scene.trackpad,
  setTrackpad: (on: boolean) => scene.setTrackpad(on),
};
wireHeader(store, pm, actions);
wireDrop($('viewport'), scene, store);
wireKeyboard(store, scene, pm, actions);
wireLengthFields(store);
buildToolbar($('toolbar'), store, scene, {
  togglePalette: () => togglePanels('palette'),
  focusArray: () => {
    if (store.selected.size) {
      actions.arrayDrag();
      return;
    }
    $('app').classList.remove('no-side');
    props.openSection('array');
  },
  mirror: () => beginMirror(store),
  showHelp: () => help.toggle(),
});
scene.onContextMenuRequest = (ctx) =>
  menu.open(ctx.x, ctx.y, menuTitle(store), buildMenu(ctx, store, scene));
