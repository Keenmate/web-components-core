/**
 * Animated diagram for examples-inputs.html, IN04 — reading a component's state
 * WITHOUT vs WITH `await el.whenSettled()`.
 *
 * Pure page illustration: plain DOM + CSS, no core APIs. The real gap between a
 * property write and the flush is ONE microtask, which the browser never paints,
 * so this slows the concept down into steps both lanes walk in lockstep:
 *
 *   0  start           — 10 rows rendered and on screen
 *   1  write           — `list.items = …` stages; core queues ONE flush microtask
 *   2  read / await    — without: the read runs now → null; with: code parks on the await
 *   3  flush           — sync code done → the microtask runs update({ items }) → 11 rows;
 *                        whenSettled() resolves (queues the code's continuation)
 *   4  resume          — with: the code continues and reads row 11 ✓
 *   5  paint           — microtask queue empty → the browser paints 11 rows in BOTH lanes
 *
 * Demo-only — not part of the published package.
 */

type LaneKind = 'without' | 'with';

interface LaneState {
  /** Highlighted code line (-1 = none). */
  line: number;
  /** Code status text + modifier. */
  codeStatus: string;
  codeMod: '' | 'running' | 'parked' | 'done';
  /** Result of the read, if any. */
  result: { text: string; isOk: boolean } | null;
  /** Microtask queue tokens. */
  queue: { label: string; state: 'queued' | 'running' | 'done' }[];
  /** Rows the component has rendered + note. */
  rows: number;
  isStaged: boolean;
  compNote: string;
  isCompActive: boolean;
  /** Rows the user sees. */
  screenRows: number;
  screenNote: string;
  isPainted: boolean;
}

const CODE: Record<LaneKind, string[]> = {
  without: [
    "list.items = [...items, 'Row 11'];",
    "const row = list.shadowRoot.querySelector('#row-11');",
  ],
  with: [
    "list.items = [...items, 'Row 11'];",
    'await list.whenSettled();',
    "const row = list.shadowRoot.querySelector('#row-11');",
  ],
};

const NOT_PAINTED = 'no paint yet — microtasks still pending';

/** One entry per step: shared narration + each lane's state. */
const STEPS: { say: string; without: LaneState; with: LaneState }[] = (() => {
  const base = (): LaneState => ({
    line: -1,
    codeStatus: 'idle',
    codeMod: '',
    result: null,
    queue: [],
    rows: 10,
    isStaged: false,
    compNote: 'rendered: 10 rows',
    isCompActive: false,
    screenRows: 10,
    screenNote: 'last paint: 10 rows',
    isPainted: false,
  });
  const s0w = base();
  const s0x = base();

  const s1w: LaneState = {
    ...s0w,
    line: 0,
    codeStatus: 'running — write',
    codeMod: 'running',
    queue: [{ label: 'flush()', state: 'queued' }],
    isStaged: true,
    compNote: 'staged: items (11) · rendered: still 10 rows',
    screenNote: NOT_PAINTED,
  };
  const s1x: LaneState = { ...s1w, queue: [{ label: 'flush()', state: 'queued' }] };

  const s2w: LaneState = {
    ...s1w,
    line: 1,
    codeStatus: 'running — read (synchronous, same tick)',
    result: { text: 'row = null ✗  (still 10 rows)', isOk: false },
  };
  const s2x: LaneState = {
    ...s1x,
    line: 1,
    codeStatus: '⏸ parked at await — waiting for the flush',
    codeMod: 'parked',
  };

  const s3w: LaneState = {
    ...s2w,
    line: -1,
    codeStatus: 'done — it already read null',
    codeMod: 'done',
    queue: [{ label: 'flush()', state: 'running' }],
    rows: 11,
    isStaged: false,
    compNote: 'update({ items }) ran → 11 rows',
    isCompActive: true,
  };
  const s3x: LaneState = {
    ...s2x,
    codeStatus: '⏸ parked — whenSettled() just resolved',
    queue: [
      { label: 'flush()', state: 'running' },
      { label: 'resume after await', state: 'queued' },
    ],
    rows: 11,
    isStaged: false,
    compNote: 'update({ items }) ran → 11 rows',
    isCompActive: true,
  };

  const s4w: LaneState = {
    ...s3w,
    queue: [{ label: 'flush()', state: 'done' }],
    compNote: 'rendered: 11 rows',
    isCompActive: false,
  };
  const s4x: LaneState = {
    ...s3x,
    line: 2,
    codeStatus: 'running — read after the flush',
    codeMod: 'running',
    result: { text: 'row = <div id="row-11"> ✓', isOk: true },
    queue: [
      { label: 'flush()', state: 'done' },
      { label: 'resume after await', state: 'running' },
    ],
    compNote: 'rendered: 11 rows',
    isCompActive: false,
  };

  const paint = (s: LaneState): LaneState => ({
    ...s,
    line: -1,
    codeStatus: 'done',
    codeMod: 'done',
    queue: s.queue.map((t) => ({ ...t, state: 'done' as const })),
    screenRows: 11,
    screenNote: 'painted: 11 rows',
    isPainted: true,
  });

  return [
    {
      say: 'Start: the list has 10 rows, rendered and on screen. Press Play or Step.',
      without: s0w,
      with: s0x,
    },
    {
      say: 'Your code assigns items. Core stages the write and queues ONE flush on a microtask — nothing has re-rendered yet.',
      without: s1w,
      with: s1x,
    },
    {
      say: 'Without: the next line runs in the same tick and queries the shadow DOM — row 11 does not exist yet. With: the await parks your code until the flush has run.',
      without: s2w,
      with: s2x,
    },
    {
      say: 'Your synchronous code is done, so the microtask runs: the flush calls update({ items }) → 11 rows. whenSettled() resolves right after that hook.',
      without: s3w,
      with: s3x,
    },
    {
      say: 'With: your code resumes and the read finds row 11. Without: nothing to redo — the earlier read already returned null.',
      without: s4w,
      with: s4x,
    },
    {
      say: 'The microtask queue is empty, so the browser paints. The user sees the same screen in both — the difference is only what your code read.',
      without: paint(s4w),
      with: paint(s4x),
    },
  ];
})();

const BASE_DELAY = 1100; // ms per step at 1×

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const bars = (n: number): string =>
  Array.from({ length: 11 }, (_, i) =>
    `<span class="anim-bar${i === 10 ? ' anim-bar--new' : ''}${i < n ? ' is-on' : ''}"></span>`,
  ).join('');

function laneMarkup(kind: LaneKind): string {
  const title = kind === 'without' ? 'Without <code>whenSettled()</code>' : 'With <code>await el.whenSettled()</code>';
  const code = CODE[kind].map((l, i) => `<span class="anim-line" data-line="${i}">${esc(l)}</span>`).join('');
  return `
    <section class="anim-lane anim-lane--${kind}" data-lane="${kind}">
      <h3 class="anim-lane-title">${title}</h3>
      <div class="anim-track">
        <div class="anim-track-label">Your code</div>
        <div class="anim-track-body">
          <pre class="anim-code">${code}</pre>
          <div class="anim-code-status"></div>
          <div class="anim-result" hidden></div>
        </div>
      </div>
      <div class="anim-track">
        <div class="anim-track-label">Microtask queue</div>
        <div class="anim-track-body"><div class="anim-queue"></div></div>
      </div>
      <div class="anim-track">
        <div class="anim-track-label">Component</div>
        <div class="anim-track-body anim-comp">
          <div class="anim-bars">${bars(10)}</div>
          <small class="muted anim-comp-note"></small>
        </div>
      </div>
      <div class="anim-track">
        <div class="anim-track-label">Screen / paint</div>
        <div class="anim-track-body anim-screen">
          <div class="anim-bars">${bars(10)}</div>
          <small class="muted anim-screen-note"></small>
        </div>
      </div>
    </section>`;
}

function renderLane(lane: HTMLElement, s: LaneState): void {
  lane.querySelectorAll<HTMLElement>('.anim-line').forEach((el) => {
    el.classList.toggle('is-current', Number(el.dataset.line) === s.line);
  });
  const status = lane.querySelector<HTMLElement>('.anim-code-status')!;
  status.textContent = s.codeStatus;
  status.dataset.mod = s.codeMod;
  const code = lane.querySelector<HTMLElement>('.anim-code')!;
  code.classList.toggle('is-parked', s.codeMod === 'parked');

  const result = lane.querySelector<HTMLElement>('.anim-result')!;
  result.hidden = !s.result;
  if (s.result) {
    result.textContent = s.result.text;
    result.classList.toggle('is-ok', s.result.isOk);
    result.classList.toggle('is-bad', !s.result.isOk);
  }

  const queue = lane.querySelector<HTMLElement>('.anim-queue')!;
  queue.innerHTML = s.queue.length
    ? s.queue.map((t) => `<span class="anim-token is-${t.state}">${esc(t.label)}${t.state === 'done' ? ' ✓' : ''}</span>`).join('')
    : '<small class="muted">empty</small>';

  const comp = lane.querySelector<HTMLElement>('.anim-comp')!;
  comp.classList.toggle('is-active', s.isCompActive);
  comp.classList.toggle('is-staged', s.isStaged);
  comp.querySelectorAll('.anim-bar').forEach((b, i) => b.classList.toggle('is-on', i < s.rows));
  comp.querySelector('.anim-comp-note')!.textContent = s.compNote;

  const screen = lane.querySelector<HTMLElement>('.anim-screen')!;
  screen.classList.toggle('is-painted', s.isPainted);
  screen.querySelectorAll('.anim-bar').forEach((b, i) => b.classList.toggle('is-on', i < s.screenRows));
  screen.querySelector('.anim-screen-note')!.textContent = s.screenNote;
}

export function mountWhenSettledAnimation(root: HTMLElement): void {
  root.innerHTML = `
    <div class="demo-label">Animated diagram <span class="muted">— the real gap is one microtask; the screen never shows it.</span></div>
    <div class="controls">
      <button type="button" class="anim-play">▶ Play</button>
      <button type="button" class="anim-step">Step ›</button>
      <button type="button" class="anim-restart">↺ Restart</button>
      <label>Speed
        <select class="anim-speed">
          <option value="0.5">0.5×</option>
          <option value="1" selected>1×</option>
          <option value="2">2×</option>
        </select>
      </label>
      <span class="pill anim-counter"></span>
    </div>
    <div class="note anim-say" aria-live="polite"></div>
    <div class="anim-lanes">${laneMarkup('without')}${laneMarkup('with')}</div>`;

  const lanes = {
    without: root.querySelector<HTMLElement>('[data-lane="without"]')!,
    with: root.querySelector<HTMLElement>('[data-lane="with"]')!,
  };
  const playBtn = root.querySelector<HTMLButtonElement>('.anim-play')!;
  const stepBtn = root.querySelector<HTMLButtonElement>('.anim-step')!;
  const restartBtn = root.querySelector<HTMLButtonElement>('.anim-restart')!;
  const speedSel = root.querySelector<HTMLSelectElement>('select.anim-speed')!;
  const counter = root.querySelector<HTMLElement>('.anim-counter')!;
  const say = root.querySelector<HTMLElement>('.anim-say')!;
  const last = STEPS.length - 1;

  let step = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const render = (): void => {
    const s = STEPS[step]!;
    root.dataset.step = String(step);
    say.textContent = s.say;
    counter.textContent = `step ${step} / ${last}`;
    renderLane(lanes.without, s.without);
    renderLane(lanes.with, s.with);
    stepBtn.disabled = step === last;
  };

  const stop = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    playBtn.textContent = '▶ Play';
    root.classList.remove('is-playing');
  };

  const tick = (): void => {
    if (step >= last) return stop();
    step++;
    render();
    if (step >= last) return stop();
    timer = setTimeout(tick, BASE_DELAY / Number(speedSel.value));
  };

  const play = (): void => {
    if (step >= last) { step = 0; render(); }
    playBtn.textContent = '❚❚ Pause';
    root.classList.add('is-playing');
    timer = setTimeout(tick, BASE_DELAY / Number(speedSel.value));
  };

  playBtn.addEventListener('click', () => (timer ? stop() : play()));
  stepBtn.addEventListener('click', () => {
    stop();
    if (step < last) { step++; render(); }
  });
  restartBtn.addEventListener('click', () => {
    stop();
    step = 0;
    render();
  });
  speedSel.addEventListener('change', () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = setTimeout(tick, BASE_DELAY / Number(speedSel.value));
  });

  render();

  // Auto-play once when the diagram first scrolls into view — not under reduced motion
  // (there it's step mode: nothing moves until you press a button).
  if (!reducedMotion.matches && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        if (!timer && step === 0) play();
      }
    }, { threshold: 0.3 });
    io.observe(root);
  }
}

const host = document.getElementById('anim-settled');
if (host) mountWhenSettledAnimation(host);
