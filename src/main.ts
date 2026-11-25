import './style.css';
import { sampleWorkbench } from './sample';
import { LumberScene } from './scene';
import { Store } from './store';
import { CutlistPanel } from './ui/cutlist';
import { $ } from './ui/dom';
import { wireLengthFields } from './ui/fields';
import { wireDrop, wireHeader, wireKeyboard, wireViews } from './ui/header';
import { buildMenu, ContextMenu, menuTitle, stockItems } from './ui/menu';
import { renderPalette } from './ui/palette';
import { OutlinerPanel } from './ui/outliner';
import { PropsPanel } from './ui/props';
import { wireStatus } from './ui/status';

const store = new Store();
const menu = new ContextMenu();
if (!store.loadAutosave()) store.replaceParts(sampleWorkbench());
store.clearHistory();

const scene = new LumberScene($('viewport'), store);
renderPalette($('boards'), $('sheets'), store);
new OutlinerPanel($('outBody'), $('outCount'), $<HTMLInputElement>('outFilter'), store, scene);
new PropsPanel($('props'), store);
new CutlistPanel($('cutBody'), store);
wireStatus($('stat'), $('overall'), store);
wireHeader(store);
wireDrop($('viewport'), scene, store);
wireViews(scene);
wireKeyboard(store, scene, {
  addMenu: () => {
    const [x, y] = scene.pointerPosition();
    menu.open(x, y, 'Add stock', [stockItems(scene.groundPoint(x, y), store)]);
  },
});
wireLengthFields(store);

scene.onContextMenuRequest = (ctx) =>
  menu.open(ctx.x, ctx.y, menuTitle(store), buildMenu(ctx, store, scene));
