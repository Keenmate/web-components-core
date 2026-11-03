import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLogger, getLogPersistKeyPrefix, LOG_LEVELS, setLogPersistKeyPrefix } from './log-core.js';
import { coreLogging } from './element-logger.js';

// Review L-02 / L-09: every component bundles its own copy of core; `vi.resetModules()` +
// a dynamic import gives a second module instance, i.e. another bundle on the same page.

afterEach(() => {
  setLogPersistKeyPrefix('km-log');
  localStorage.clear();
});

describe('logging across copies of core', () => {
  it('setLogPersistKeyPrefix() through another copy applies to this copy too', async () => {
    vi.resetModules();
    const other = await import('./log-core.js');
    other.setLogPersistKeyPrefix('my-app-log');
    expect(getLogPersistKeyPrefix()).toBe('my-app-log');
  });

  it('a logger created before the prefix change adopts the level stored under the new key', () => {
    const logger = getLogger('XCOPY:UI');
    expect(logger.getLevel()).not.toBe(LOG_LEVELS.ERROR);
    localStorage.setItem('my-app-log:XCOPY:UI', 'ERROR');
    setLogPersistKeyPrefix('my-app-log');
    expect(logger.getLevel()).toBe(LOG_LEVELS.ERROR);
  });

  it('the CORE bundle is one per page', async () => {
    vi.resetModules();
    const other = await import('./element-logger.js');
    expect(other.coreLogging).toBe(coreLogging);
  });
});
