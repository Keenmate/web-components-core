import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMenuDivider, getMenuChildren, isActionBusy, resolveMenuEntries, runAction } from './resolve.js';
import type { ActionEventDetail, ActionItem, MenuEntry, MenuItem } from './types.js';

// Review 2026-11-03 A-27 (test gaps): the /actions scenarios resolve.test.ts did not cover yet.

interface RowCtx {
  row: { status: string };
}
const ctx: RowCtx = { row: { status: 'open' } };

function detail(item: ActionItem<RowCtx>, element?: object, trigger?: HTMLElement): ActionEventDetail<RowCtx> {
  const d = { ...ctx, action: item.action ?? 'custom', id: item.id, item, source: 'row-toolbar', triggerElement: trigger, dataset: {} } as ActionEventDetail<RowCtx>;
  if (element) Object.defineProperty(d, 'element', { value: element, enumerable: false });
  return d;
}

const shape = (entries: readonly (MenuEntry<RowCtx> | string)[]) =>
  resolveMenuEntries(entries, ctx).map((e) => (e.kind === 'divider' ? `--${e.text ?? ''}` : e.resolved.id));

afterEach(() => vi.restoreAllMocks());

describe('A-27 resolveMenuEntries — divider merge', () => {
  // A-27 (A-06): resolve.test.ts covers unlabelled-then-labelled; this is the other order.
  it('a labelled divider followed by an unlabelled one keeps the label', () => {
    expect(shape([{ id: 'a' }, createMenuDivider('Group'), createMenuDivider(), { id: 'b' }])).toEqual(['a', '--Group', 'b']);
  });

  it('two labelled dividers in a row: the later label wins', () => {
    expect(shape([{ id: 'a' }, createMenuDivider('One'), createMenuDivider('Two'), { id: 'b' }])).toEqual(['a', '--Two', 'b']);
  });

  it('a divider separated only by hidden items still merges; a leading labelled one survives a following plain one', () => {
    expect(shape([{ id: 'a' }, createMenuDivider(), { id: 'h', isVisible: false }, createMenuDivider('G'), { id: 'b' }])).toEqual([
      'a',
      '--G',
      'b',
    ]);
    expect(shape([createMenuDivider('Head'), createMenuDivider(), { id: 'a' }])).toEqual(['--Head', 'a']);
  });
});

describe('A-27 getMenuChildren', () => {
  it('a getChildrenCallback returning undefined / null (sync or async) gives []', async () => {
    const item = (cb: () => unknown) => ({ getChildrenCallback: cb }) as unknown as MenuItem<RowCtx>;
    expect(await getMenuChildren(item(() => undefined), ctx)).toEqual([]);
    expect(await getMenuChildren(item(() => null), ctx)).toEqual([]);
    expect(await getMenuChildren(item(async () => undefined), ctx)).toEqual([]);
    expect(await getMenuChildren(item(async () => null), ctx)).toEqual([]);
  });

  it('a rejecting getChildrenCallback is logged and falls back to the static children', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const item: MenuItem<RowCtx> = { children: [{ id: 's' }], getChildrenCallback: async () => Promise.reject(new Error('no')) };
    expect(await getMenuChildren(item, ctx)).toEqual([{ id: 's' }]);
    expect(error).toHaveBeenCalled();
  });
});

describe('A-27 runAction', () => {
  // A-27 (A-07): resolve.test.ts runs a DIFFERENT item on the second host; this runs the SAME one.
  it('the same item shared by two instances runs on both at once; each guard is per instance', async () => {
    const releases: (() => void)[] = [];
    const onClick = vi.fn(() => new Promise<void>((r) => releases.push(r)));
    const shared: ActionItem<RowCtx> = { id: 'save', onClick };
    const hostA = {};
    const hostB = {};
    const btnA = document.createElement('button');
    const btnB = document.createElement('button');
    const emitA = vi.fn();
    const emitB = vi.fn();
    const a = runAction({ detail: detail(shared, hostA, btnA), emitAction: emitA });
    const b = runAction({ detail: detail(shared, hostB, btnB), emitAction: emitB });
    await Promise.resolve();
    await Promise.resolve();
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(btnA.getAttribute('aria-busy')).toBe('true');
    expect(btnB.getAttribute('aria-busy')).toBe('true');
    expect(isActionBusy(shared, hostA)).toBe(true);
    expect(isActionBusy(shared, hostB)).toBe(true);
    // a second activation on A is still ignored while A runs
    await expect(runAction({ detail: detail(shared, hostA), emitAction: emitA })).resolves.toBe(false);
    releases[0]!(); // A finishes; B still busy, and so "anywhere"
    await expect(a).resolves.toBe(true);
    expect(isActionBusy(shared, hostA)).toBe(false);
    expect(isActionBusy(shared, hostB)).toBe(true);
    expect(isActionBusy(shared)).toBe(true);
    expect(btnA.hasAttribute('aria-busy')).toBe(false);
    releases[1]!();
    await expect(b).resolves.toBe(true);
    expect(isActionBusy(shared)).toBe(false);
    expect(emitA).toHaveBeenCalledOnce();
    expect(emitB).toHaveBeenCalledOnce();
  });

  // A-27 (A-17) + (A-15): pre-existing aria-busy="true" survives, also when the action fails.
  it('a pre-existing aria-busy="true" is restored after a throwing event handler', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const btn = document.createElement('button');
    btn.setAttribute('aria-busy', 'true');
    const ok = await runAction({
      detail: detail({ id: 'x' }, undefined, btn),
      emitAction: () => {
        throw new Error('listener boom');
      },
    });
    expect(ok).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('isActionBusy is true during a pending onClick (after the before-callback resolved)', async () => {
    let release!: () => void;
    const item: ActionItem<RowCtx> = { id: 'slow', onClick: () => new Promise<void>((r) => (release = r)) };
    const host = {};
    let busyInBefore: boolean | undefined;
    const run = runAction({
      detail: detail(item, host),
      beforeActionCallback: async () => void (busyInBefore = isActionBusy(item, host)),
      emitAction: () => {},
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(busyInBefore).toBe(true);
    expect(release).toBeTypeOf('function'); // onClick has started
    expect(isActionBusy(item, host)).toBe(true);
    release();
    await run;
    expect(isActionBusy(item, host)).toBe(false);
  });
});
