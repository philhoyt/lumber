import './style.css';
import { sampleWorkbench } from './sample';
import { LumberScene } from './scene';
import { Store } from './store';
import { CutlistPanel } from './ui/cutlist';
import { $ } from './ui/dom';
import { wireDrop, wireHeader, wireKeyboard, wireViews } from './ui/header';
import { renderPalette } from './ui/palette';
import { PropsPanel } from './ui/props';
import { wireStatus } from './ui/status';

const store = new Store();
if (!store.loadAutosave()) store.replaceParts(sampleWorkbench());
store.clearHistory();

const scene = new LumberScene($('viewport'), store);
renderPalette($('boards'), $('sheets'), store);
new PropsPanel($('props'), store);
new CutlistPanel($('cutBody'), store);
wireStatus($('stat'), $('overall'), store);
wireHeader(store);
wireDrop($('viewport'), scene, store);
wireViews(scene);
wireKeyboard(store, scene);
