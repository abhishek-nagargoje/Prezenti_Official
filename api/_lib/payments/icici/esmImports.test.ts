import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

/**
 * Regression guard for the production outage this test was added after:
 * Vercel deploys api/*.ts as compiled, native Node ESM .js files. Node
 * ESM requires every LOCAL relative import specifier to include its
 * real extension (`.js`, pointing at the file that will actually exist
 * once TypeScript compiles this .ts source) — unlike bundler/Vite-style
 * resolution, it will never infer a missing extension. An extensionless
 * local import (e.g. `from './callback'` instead of `from './callback.js'`)
 * typechecks fine and passes every local test (vitest resolves it via
 * Vite, not plain Node), but crashes the deployed function at cold start
 * with `ERR_MODULE_NOT_FOUND` — regardless of HTTP method, before any
 * request handling code runs. This test statically scans every source
 * file actually deployed to Vercel and fails if any local relative
 * import is missing its `.js` extension, so this class of bug can never
 * reach production again.
 */

const SOURCE_GLOBS = ['api/payments/icici/**/*.ts', 'api/_lib/payments/icici/**/*.ts'];

const LOCAL_IMPORT_PATTERN = /(?:import|export)\s[^;]*?\bfrom\s+['"](\.\.?\/[^'"]+)['"]/g;

function findSourceFiles(): string[] {
  const files: string[] = [];
  for (const pattern of SOURCE_GLOBS) {
    files.push(...globSync(pattern, { cwd: process.cwd() }));
  }
  return files.filter((file) => !file.endsWith('.test.ts'));
}

describe('ICICI server-side source files use Node-ESM-compatible local import specifiers', () => {
  const sourceFiles = findSourceFiles();

  it('found the expected ICICI source files to scan (sanity check that this test is not silently a no-op)', () => {
    expect(sourceFiles.length).toBeGreaterThanOrEqual(15);
    expect(sourceFiles.some((f) => f.endsWith('return.ts'))).toBe(true);
    expect(sourceFiles.some((f) => f.endsWith('repository.ts'))).toBe(true);
  });

  for (const file of findSourceFiles()) {
    it(`${file}: every local relative import specifier ends in .js`, () => {
      const content = readFileSync(file, 'utf8');
      const offenders: string[] = [];

      for (const match of content.matchAll(LOCAL_IMPORT_PATTERN)) {
        const specifier = match[1];
        if (!specifier.endsWith('.js')) {
          offenders.push(specifier);
        }
      }

      expect(offenders).toEqual([]);
    });
  }
});
