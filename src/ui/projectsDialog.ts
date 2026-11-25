/** The Projects dialog: open, create, duplicate, rename, delete and import projects. */
import { Copy, FolderInput, Pencil, Plus, Trash2, X } from 'lucide';
import type { ProjectManager } from '../projectManager';
import { timeAgo } from '../projects';
import { esc } from './dom';
import { icon } from './icons';

export class ProjectsDialog {
  private dialog: HTMLDialogElement;
  private body: HTMLElement;
  private renaming: string | null = null;
  private confirming: string | null = null;

  constructor(
    host: HTMLElement,
    private pm: ProjectManager,
  ) {
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'dlg projects-dlg';
    this.dialog.innerHTML = `<div class="dlg-head"><h2>Projects</h2><span class="muted">Kept in this browser. Export a project to send it anywhere else.</span><span class="spacer"></span><button class="icon ghost" id="pjClose" title="Close (Esc)"></button></div><div class="dlg-body"></div><div class="dlg-foot"><button id="pjNew" class="primary"></button><button id="pjImport"></button><input id="pjFile" type="file" accept=".json,application/json" hidden></div>`;
    host.appendChild(this.dialog);
    this.body = this.dialog.querySelector('.dlg-body')!;
    const close = this.dialog.querySelector<HTMLButtonElement>('#pjClose')!;
    close.appendChild(icon(X));
    close.onclick = () => this.hide();
    const add = this.dialog.querySelector<HTMLButtonElement>('#pjNew')!;
    add.append(icon(Plus, 14), 'New project');
    add.onclick = () => {
      this.pm.newProject();
      this.hide();
    };
    const file = this.dialog.querySelector<HTMLInputElement>('#pjFile')!;
    const imp = this.dialog.querySelector<HTMLButtonElement>('#pjImport')!;
    imp.append(icon(FolderInput, 14), 'Import JSON');
    imp.onclick = () => file.click();
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      if (await this.pm.importFile(f)) this.hide();
      else this.render('That file is not a Lumber model.');
    });
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.hide();
    });
  }

  get open(): boolean {
    return this.dialog.open;
  }
  show(): void {
    this.renaming = null;
    this.confirming = null;
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }
  hide(): void {
    this.dialog.close();
  }

  private render(message = ''): void {
    const { pm, body } = this;
    body.textContent = '';
    if (message) {
      const m = document.createElement('div');
      m.className = 'warn note';
      m.textContent = message;
      body.appendChild(m);
    }
    for (const p of pm.list()) {
      const row = document.createElement('div');
      row.className = 'proj-row' + (p.id === pm.current.id ? ' current' : '');
      const main = document.createElement('div');
      main.className = 'proj-main';
      const name = document.createElement('div');
      name.className = 'proj-name';
      if (this.renaming === p.id) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = p.name;
        input.maxLength = 80;
        const done = (ok: boolean) => {
          if (this.renaming !== p.id) return;
          this.renaming = null;
          if (ok) pm.rename(p.id, input.value);
          this.render();
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') done(true);
          else if (e.key === 'Escape') done(false);
          e.stopPropagation();
        });
        input.addEventListener('blur', () => done(true));
        name.appendChild(input);
        queueMicrotask(() => {
          input.focus();
          input.select();
        });
      } else name.textContent = p.name;
      const meta = document.createElement('div');
      meta.className = 'proj-meta muted';
      meta.textContent = `${p.parts} part${p.parts === 1 ? '' : 's'} · ${timeAgo(p.updated)}${p.id === pm.current.id ? ' · open' : ''}`;
      main.append(name, meta);
      main.addEventListener('click', () => {
        if (this.renaming) return;
        pm.open(p.id);
        this.hide();
      });

      const actions = document.createElement('div');
      actions.className = 'proj-actions';
      const btn = (node: Parameters<typeof icon>[0], title: string, fn: () => void, cls = '') => {
        const b = document.createElement('button');
        b.className = `icon ghost ${cls}`;
        b.title = title;
        b.appendChild(icon(node, 15));
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          fn();
        });
        return b;
      };
      actions.append(
        btn(Pencil, 'Rename', () => {
          this.renaming = p.id;
          this.render();
        }),
        btn(Copy, 'Duplicate and open the copy', () => {
          pm.duplicate(p.id);
          this.hide();
        }),
      );
      if (this.confirming === p.id) {
        const sure = document.createElement('button');
        sure.className = 'danger';
        sure.textContent = `Delete ${esc(p.name)}?`;
        sure.title = 'This cannot be undone';
        sure.addEventListener('click', (e) => {
          e.stopPropagation();
          this.confirming = null;
          pm.remove(p.id);
          this.render();
        });
        actions.appendChild(sure);
      } else
        actions.appendChild(
          btn(
            Trash2,
            'Delete',
            () => {
              this.confirming = p.id;
              this.render();
            },
            'danger',
          ),
        );
      row.append(main, actions);
      body.appendChild(row);
    }
  }
}
