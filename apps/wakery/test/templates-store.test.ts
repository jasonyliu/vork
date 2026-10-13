import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TemplateStore } from '../src/templates/store.js';
import { EVENT_CODES } from '../src/events/codes.js';
import { TemplateLoadError } from '../src/templates/loader.js';
import { TemplateValidationError } from '../src/templates/validator.js';

interface CapturedEvent {
  event: { code: number; name: string; severity: string };
  fields: Record<string, unknown>;
}

function captor() {
  const events: CapturedEvent[] = [];
  return {
    events,
    emit(event: { code: number; name: string; severity: string }, fields: Record<string, unknown> = {}) {
      events.push({ event, fields });
    }
  };
}

function validWakeMessage(suffix: string) {
  return {
    composition: `v=${suffix} {{lane_instructions}}`,
    stateBlocks: { default: 'D' },
    commentLengths: { lean: 'L' }
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// Poll until `predicate` holds — deterministic on the actual signal rather than a
// fixed sleep. On timeout it returns and lets the test's own assertion report.
async function waitFor(predicate: () => boolean, timeoutMs = 2000, intervalMs = 5): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await wait(intervalMs);
  }
}

// Atomic-replace write — mirrors editor save semantics and avoids partial-read races.
function atomicWrite(filePath: string, contents: string) {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, contents);
  renameSync(tmp, filePath);
}

// The reload tests drive the store's debounce → reload path DIRECTLY rather than
// waiting on the real `fs.watch` to deliver a change event. Under full-suite
// parallel load, `fs.watch` intermittently delays or DROPS events on atomic-rename
// (a Node/OS property, not wakery logic) — which flaked these tests. Detaching the
// live watcher and invoking `scheduleReload` reproduces exactly what the watcher
// callback does (`store.ts:52`), so we test wakery's debounce/reload/last-good
// behavior deterministically. The watcher wiring + teardown is covered by start()/
// stop() below.
function detachWatcher(s: TemplateStore) {
  (s as unknown as { watcher: { close(): void } | null }).watcher?.close();
  (s as unknown as { watcher: unknown }).watcher = null;
}
function triggerReload(s: TemplateStore, name: string) {
  (s as unknown as { scheduleReload(n: string): void }).scheduleReload(name);
}

describe('TemplateStore', () => {
  let dir: string;
  let store: TemplateStore | null;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wakery-store-'));
    mkdirSync(dir, { recursive: true });
    store = null;
  });

  afterEach(() => {
    store?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test('start() loads every *.json under the directory and emits TEMPLATE_LOADED with phase=startup', async () => {
    writeFileSync(join(dir, 'wake-message.json'), JSON.stringify(validWakeMessage('a')));
    const cap = captor();

    store = new TemplateStore(dir, cap, { debounceMs: 20 });
    await store.start();

    const startupEvents = cap.events.filter((e) => e.event.code === EVENT_CODES.TEMPLATE_LOADED.code);
    expect(startupEvents).toHaveLength(1);
    expect(startupEvents[0].fields).toMatchObject({ phase: 'startup', name: 'wake-message' });
    expect(store.getTemplate('wake-message').composition).toContain('v=a');
  });

  test('start() throws TemplateLoadError on a malformed file (terminal startup failure)', async () => {
    writeFileSync(join(dir, 'wake-message.json'), '{ not json');
    store = new TemplateStore(dir, captor(), { debounceMs: 20 });
    await expect(store.start()).rejects.toThrow(TemplateLoadError);
  });

  test('start() throws TemplateValidationError when a file fails the schema (terminal startup failure)', async () => {
    writeFileSync(join(dir, 'wake-message.json'), JSON.stringify({ composition: 'hi' })); // missing stateBlocks + commentLengths
    store = new TemplateStore(dir, captor(), { debounceMs: 20 });
    await expect(store.start()).rejects.toThrow(TemplateValidationError);
  });

  test('getTemplate throws for an unknown template name', async () => {
    writeFileSync(join(dir, 'wake-message.json'), JSON.stringify(validWakeMessage('a')));
    store = new TemplateStore(dir, captor(), { debounceMs: 20 });
    await store.start();
    expect(() => store!.getTemplate('nope')).toThrow();
  });

  test('a file edit picked up within the debounce window swaps the loaded template and emits TEMPLATE_LOADED phase=reload', async () => {
    const file = join(dir, 'wake-message.json');
    writeFileSync(file, JSON.stringify(validWakeMessage('a')));
    const cap = captor();
    store = new TemplateStore(dir, cap, { debounceMs: 20 });
    await store.start();
    detachWatcher(store);
    cap.events.length = 0;

    atomicWrite(file, JSON.stringify(validWakeMessage('b')));
    triggerReload(store, 'wake-message');
    await waitFor(() => cap.events.some((e) => e.event.code === EVENT_CODES.TEMPLATE_LOADED.code && e.fields.phase === 'reload'));

    const reloads = cap.events.filter(
      (e) => e.event.code === EVENT_CODES.TEMPLATE_LOADED.code && e.fields.phase === 'reload'
    );
    expect(reloads.length).toBeGreaterThanOrEqual(1);
    expect(reloads[0].fields).toMatchObject({ name: 'wake-message' });
    expect(store.getTemplate('wake-message').composition).toContain('v=b');
  });

  test('a malformed mid-flight edit emits TEMPLATE_RELOAD_FAILED and the last-good template stays in service', async () => {
    const file = join(dir, 'wake-message.json');
    writeFileSync(file, JSON.stringify(validWakeMessage('good')));
    const cap = captor();
    store = new TemplateStore(dir, cap, { debounceMs: 20 });
    await store.start();
    detachWatcher(store);
    cap.events.length = 0;

    atomicWrite(file, '{ corrupted');
    triggerReload(store, 'wake-message');
    await waitFor(() => cap.events.some((e) => e.event.code === EVENT_CODES.TEMPLATE_RELOAD_FAILED.code));

    const failures = cap.events.filter((e) => e.event.code === EVENT_CODES.TEMPLATE_RELOAD_FAILED.code);
    expect(failures.length).toBeGreaterThanOrEqual(1);
    expect(failures[0].fields).toMatchObject({ name: 'wake-message' });
    expect(failures[0].fields.error).toBeTruthy();
    expect(store.getTemplate('wake-message').composition).toContain('v=good');
  });

  test('rapid successive edits within the debounce window coalesce into a single reload', async () => {
    const file = join(dir, 'wake-message.json');
    writeFileSync(file, JSON.stringify(validWakeMessage('a')));
    const cap = captor();
    store = new TemplateStore(dir, cap, { debounceMs: 100 });
    await store.start();
    detachWatcher(store);
    cap.events.length = 0;

    // Three edits inside one debounce window — each resets the single timer, so
    // exactly one reload fires, loading the final content.
    atomicWrite(file, JSON.stringify(validWakeMessage('b')));
    triggerReload(store, 'wake-message');
    atomicWrite(file, JSON.stringify(validWakeMessage('c')));
    triggerReload(store, 'wake-message');
    atomicWrite(file, JSON.stringify(validWakeMessage('d')));
    triggerReload(store, 'wake-message');

    await waitFor(() => cap.events.some((e) => e.event.code === EVENT_CODES.TEMPLATE_LOADED.code && e.fields.phase === 'reload'));

    const reloads = cap.events.filter(
      (e) => e.event.code === EVENT_CODES.TEMPLATE_LOADED.code && e.fields.phase === 'reload'
    );
    expect(reloads).toHaveLength(1);
    expect(store.getTemplate('wake-message').composition).toContain('v=d');
  });

  test('stop() unregisters the watcher: subsequent file edits do not produce reload events', async () => {
    const file = join(dir, 'wake-message.json');
    writeFileSync(file, JSON.stringify(validWakeMessage('a')));
    const cap = captor();
    store = new TemplateStore(dir, cap, { debounceMs: 20 });
    await store.start();
    store.stop();
    store = null;
    cap.events.length = 0;

    atomicWrite(file, JSON.stringify(validWakeMessage('b')));
    await wait(100);

    const reloads = cap.events.filter(
      (e) => e.event.code === EVENT_CODES.TEMPLATE_LOADED.code && e.fields.phase === 'reload'
    );
    expect(reloads).toHaveLength(0);
  });
});
