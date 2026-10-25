/**
 * Test helper (excluded from the build): turn one captured `console.*` call
 * into the line's label + message — `%c` directives and their CSS arguments
 * dropped, then the first message argument. Detail arguments after the message
 * (values, Error objects) are left out, mirroring the old `String(call[0])`
 * assertions.
 *
 * `['%c[NS:INIT]%c #x', css, css, 'msg', detail]` → `'[NS:INIT] #x msg'`
 */
export function consoleLine(args: readonly unknown[]): string {
  const [first, ...rest] = args;
  if (typeof first !== 'string' || !first.includes('%c')) return String(first);
  const cssCount = first.split('%c').length - 1;
  const message = rest[cssCount];
  const label = first.replace(/%c/g, '');
  return message === undefined ? label : `${label} ${String(message)}`;
}

/** Every captured call of a spy as {@link consoleLine} text. */
export function consoleLines(spy: { mock: { calls: readonly (readonly unknown[])[] } }): string[] {
  return spy.mock.calls.map((call) => consoleLine(call));
}
