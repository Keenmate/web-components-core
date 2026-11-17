/**
 * Form submission through light-DOM hidden inputs (SPEC §12.21) — the Keenmate convention: a component
 * that submits a value writes `<input type="hidden" name>` children of its host (so they sit inside the
 * `<form>`), never `setFormValue`. web-multiselect, web-daterangepicker and web-editor each had a copy.
 *
 * - {@link createFormInputs}: owns the inputs — a string is one `name` input, an array one `name[]` input
 *   per item; inputs are reused, never get an `id` (two pickers with one name, or a host whose id is its
 *   name, would duplicate it), and are `disabled` while the control is (a disabled control submits nothing).
 * - {@link formatFormValue}: the value in the `value-format` (`json` / `text` / `array`) or through the
 *   component's `getValueFormatCallback`; a throwing callback yields `''` + the error — the component marks
 *   itself invalid (`setFormatError`) and emits `value-format-error`.
 */

export type FormValueFormat = 'json' | 'text' | 'array';

export interface FormInputs {
  /**
   * Write the submitted value: a string → one `<input name>`, an array → one `<input name="name[]">` per
   * item (none for an empty array). A `null` / empty `name` removes the inputs (no form participation).
   */
  write(name: string | null | undefined, value: string | readonly string[], opts?: { isDisabled?: boolean }): void;
  /** Remove every input this helper wrote (e.g. `destroyCallback()`). */
  clear(): void;
  /** The inputs currently written, in order. */
  readonly inputs: readonly HTMLInputElement[];
}

/** Hidden form inputs owned by `host` (appended as its light-DOM children). */
export function createFormInputs(host: HTMLElement): FormInputs {
  let inputs: HTMLInputElement[] = [];
  const clear = (): void => {
    for (const input of inputs) input.remove();
    inputs = [];
  };
  return {
    write(name, value, opts) {
      if (!name) {
        clear();
        return;
      }
      const isArray = typeof value !== 'string';
      const values: readonly string[] = isArray ? value : [value];
      const inputName = isArray ? `${name}[]` : name;
      const isDisabled = !!opts?.isDisabled;
      for (const extra of inputs.splice(values.length)) extra.remove();
      values.forEach((v, i) => {
        let input = inputs[i];
        if (!input) {
          input = host.ownerDocument.createElement('input');
          input.type = 'hidden';
          inputs.push(input);
        }
        input.name = inputName;
        input.value = String(v);
        input.disabled = isDisabled;
        // a framework that re-rendered the host's children may have dropped it
        if (input.parentNode !== host) host.appendChild(input);
      });
    },
    clear,
    get inputs() {
      return inputs;
    },
  };
}

export interface FormatFormValueOptions {
  /** The `text` format's separator. Default `','`. */
  separator?: string;
  /**
   * The component's `getValueFormatCallback`, already bound to its context (it wins over `format`, also
   * over `array`: one field). `null` / `undefined` results submit `''`.
   */
  callback?: ((values: readonly (string | number)[]) => unknown) | null;
}

export interface FormattedFormValue {
  /** What to submit: a string, or one string per `name[]` input for `array`. */
  value: string | string[];
  /** Set when the callback threw (`value` is then `''`). */
  error?: unknown;
}

/**
 * The submitted value for `values` in `format` (default `json`): `json` → `JSON.stringify(values)`,
 * `text` → joined by `separator`, `array` → one string per value. A `callback` wins over all of them.
 */
export function formatFormValue(
  values: readonly (string | number)[],
  format: FormValueFormat | null | undefined,
  opts: FormatFormValueOptions = {},
): FormattedFormValue {
  if (opts.callback) {
    try {
      return { value: String(opts.callback(values) ?? '') };
    } catch (error) {
      // a thrown `undefined` still counts as a failure
      return { value: '', error: error ?? new Error('getValueFormatCallback threw') };
    }
  }
  if (format === 'array') return { value: values.map((v) => String(v)) };
  if (format === 'text') return { value: values.join(opts.separator ?? ',') };
  return { value: JSON.stringify(values) };
}
