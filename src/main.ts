import './style.css';
import { sampleWorkbench } from './sample';
import { LumberScene } from './scene';
import { Store } from './store';
import { CutlistPanel } from './ui/cutlist';
import { $ } from './ui/dom';
import { wireLengthFields } from './ui/fields';
import { togglePanels, wireDrop, wireHeader, wireKeyboard, wireTabs } from './ui/header';
import { HelpOverlay } from './ui/help';
import { buildMenu, ContextMenu, menuTitle, stockItems } from './ui/menu';
import { OutlinerPanel } from './ui/outliner';
import { renderPalette } from './ui/palette';
import { PropsPanel } from './ui/props';
import { wireStatus } from './ui/status';
import { initTheme, type Theme } from './ui/theme';
import { buildToolbar } from './ui/toolbar';

const theme = initTheme();
const store = new Store();
const menu = new ContextMenu();
if (!store.loadAutosave()) store.replaceParts(sampleWorkbench());
store.clearHistory();

const scene = new LumberScene($('viewport'), store);
scene.setTheme(theme);
const help = new HelpOverlay($('help'));
const props = new PropsPanel($('props'), store);
renderPalette($('boards'), $('sheets'), $<HTMLInputElement>('palSearch'), store);
new OutlinerPanel($('outBody'), $('outCount'), $<HTMLInputElement>('outFilter'), store, scene);
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
    if (menu.isOpen) {
      menu.close();
      return true;
    }
    return false;
  },
  onTheme: (t: Theme) => scene.setTheme(t),
};
wireHeader(store, actions);
wireDrop($('viewport'), scene, store);
wireKeyboard(store, scene, actions);
wireLengthFields(store);
buildToolbar($('toolbar'), store, scene, {
  togglePalette: () => togglePanels('palette'),
  focusArray: () => {
    $('app').classList.remove('no-side');
    props.openSection('array');
    (
      document.getElementById('arrN') ??
      document.getElementById('arrFit') ??
      document.getElementById('arrS')
    )?.focus();
  },
  showHelp: () => help.toggle(),
});
scene.onContextMenuRequest = (ctx) =>
  menu.open(ctx.x, ctx.y, menuTitle(store), buildMenu(ctx, store, scene));
