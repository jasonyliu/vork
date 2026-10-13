import { readdirSync, watch, type FSWatcher } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { EVENT_CODES } from '../events/codes.js';
import { loadTemplateFile } from './loader.js';
import { validateTemplate, type GovernNoticeMessageTemplate, type RewakeMessageTemplate, type WakeMessageTemplate } from './validator.js';

export type LoadedTemplate = WakeMessageTemplate | RewakeMessageTemplate | GovernNoticeMessageTemplate;

const DEFAULT_DEBOUNCE_MS = 100;

interface EventCode {
  code: number;
  name: string;
  severity: string;
}

interface Emitter {
  emit(event: EventCode, fields?: Record<string, unknown>): void;
}

export interface TemplateStoreOptions {
  debounceMs?: number;
}

export class TemplateStore {
  private readonly debounceMs: number;
  private readonly loaded = new Map<string, LoadedTemplate>();
  private readonly lastGood = new Map<string, LoadedTemplate>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private watcher: FSWatcher | null = null;
  private stopped = false;

  constructor(
    private readonly templateDir: string,
    private readonly emitter: Emitter,
    options: TemplateStoreOptions = {}
  ) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  async start(): Promise<void> {
    const files = readdirSync(this.templateDir).filter((f) => extname(f) === '.json');
    for (const file of files) {
      const name = basename(file, '.json');
      const template = this.loadOne(name);
      this.loaded.set(name, template);
      this.lastGood.set(name, template);
      this.emitter.emit(EVENT_CODES.TEMPLATE_LOADED, { phase: 'startup', name });
    }
    this.watcher = watch(this.templateDir, (_evt, filename) => {
      if (!filename || extname(filename) !== '.json') return;
      this.scheduleReload(basename(filename, '.json'));
    });
  }

  getTemplate(name: string): LoadedTemplate {
    const t = this.loaded.get(name);
    if (!t) throw new Error(`template ${name} is not loaded`);
    return t;
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.watcher?.close();
    this.watcher = null;
  }

  private scheduleReload(name: string): void {
    if (this.stopped) return;
    const existing = this.timers.get(name);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(name);
      this.reload(name);
    }, this.debounceMs);
    this.timers.set(name, timer);
  }

  private reload(name: string): void {
    if (this.stopped) return;
    try {
      const template = this.loadOne(name);
      this.loaded.set(name, template);
      this.lastGood.set(name, template);
      this.emitter.emit(EVENT_CODES.TEMPLATE_LOADED, { phase: 'reload', name });
    } catch (err) {
      this.emitter.emit(EVENT_CODES.TEMPLATE_RELOAD_FAILED, {
        name,
        error: (err as Error).message,
        error_name: (err as Error).name
      });
      // last-good remains in this.loaded — no swap on failure per spec §Stage 2.
    }
  }

  private loadOne(name: string): LoadedTemplate {
    const filePath = join(this.templateDir, `${name}.json`);
    const parsed = loadTemplateFile(filePath);
    return validateTemplate(name, parsed);
  }
}
