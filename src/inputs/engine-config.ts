/**
 * Canonical engine-config assembly. A component turns {@link BlissElement}'s
 * merged `config` bag into the object it hands to its engine; this is the one
 * correct way to do that step, so every component shares it instead of
 * hand-rolling a null-handling loop that drifts (SPEC §6, "null-clear" contract).
 *
 * The one rule: **`null` is PRESERVED, never blanket-deleted.** A value is only
 * ever `null` in `config` when its input descriptor admits `null` — i.e. the
 * author declared `null` a meaningful, cleared state (nullable `toText`, tristate
 * `toBool`, `toFunction`, a `shouldNullOnInvalid` enum, or a `default: null`
 * row). Forwarding that `null` is what lets a cleared field reset: the engine
 * resolves it with the mechanism it already has (`?? DEFAULT` for defaulted
 * fields, direct-assign for clearable ones). Dropping it — the old per-component
 * behavior — is exactly the bug that made clearing a nullable input a silent
 * no-op.
 *
 * `exclude` removes keys the engine must never see (component-only config such
 * as `theme`, or keys the component applies itself). It is NOT a null filter.
 */
export function collectEngineConfig(
  config: Record<string, unknown>,
  opts?: { exclude?: Iterable<string> },
): Record<string, unknown> {
  const out = { ...config };
  if (opts?.exclude) for (const key of opts.exclude) delete out[key];
  return out; // NOTE: null is preserved — see module doc.
}
