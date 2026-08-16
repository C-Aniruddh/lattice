/**
 * The repo's own invariants, as tests.
 *
 * `.lattice/kit.json` is the map agents navigate by, and a map that drifts from the terrain
 * is worse than no map — an agent trusts it, reads the wrong file, and reports on code that
 * does not exist. These tests are what let the manifest be trusted: they fail the moment it
 * describes a package that is missing, an edge that is not in the real `package.json`, or a
 * dependency graph that has grown a cycle.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const kit = JSON.parse(readFileSync(join(ROOT, '.lattice/kit.json'), 'utf8')) as Kit;

interface KitPackage {
  readonly name: string;
  readonly purpose: string;
  readonly environment: string;
  readonly dependsOn: readonly string[];
  readonly modules: readonly string[];
  readonly exports: readonly string[];
  readonly invariants: readonly string[];
}

interface Kit {
  readonly scope: string;
  readonly layers: readonly { readonly layer: number; readonly packages: readonly string[] }[];
  readonly packages: Readonly<Record<string, KitPackage>>;
  readonly budgets: Readonly<Record<string, number>>;
}

const ids = Object.keys(kit.packages);

describe('the manifest describes packages that exist', () => {
  it.each(ids)('%s has a package.json, an entry point and a README', (id) => {
    const dir = join(ROOT, 'packages', id);
    expect(existsSync(join(dir, 'package.json')), `${id}/package.json`).toBe(true);
    expect(existsSync(join(dir, 'src/index.ts')), `${id}/src/index.ts`).toBe(true);
    expect(existsSync(join(dir, 'README.md')), `${id}/README.md`).toBe(true);
  });

  it.each(ids)('%s declares the same dependencies in both places', (id) => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'packages', id, 'package.json'), 'utf8'),
    ) as { name: string; dependencies?: Record<string, string> };
    const declared = Object.keys(manifest.dependencies ?? {})
      .filter((d) => d.startsWith(`${kit.scope}/`))
      .map((d) => d.slice(kit.scope.length + 1))
      .sort();
    expect(manifest.name).toBe((kit.packages[id] as KitPackage).name);
    expect(declared).toEqual([...(kit.packages[id] as KitPackage).dependsOn].sort());
  });

  it('every package sits on exactly one layer', () => {
    const seen = kit.layers.flatMap((l) => l.packages);
    expect([...seen].sort()).toEqual([...ids].sort());
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe('the dependency graph', () => {
  it('is acyclic', () => {
    const state = new Map<string, 'visiting' | 'done'>();
    const trail: string[] = [];
    const visit = (id: string): void => {
      if (state.get(id) === 'done') return;
      if (state.get(id) === 'visiting') {
        throw new Error(`cycle: ${[...trail, id].join(' → ')}`);
      }
      state.set(id, 'visiting');
      trail.push(id);
      for (const dep of (kit.packages[id] as KitPackage).dependsOn) visit(dep);
      trail.pop();
      state.set(id, 'done');
    };
    expect(() => ids.forEach(visit)).not.toThrow();
  });

  it('only ever points downhill', () => {
    const layerOf = new Map<string, number>();
    for (const { layer, packages } of kit.layers) for (const id of packages) layerOf.set(id, layer);
    for (const id of ids) {
      for (const dep of (kit.packages[id] as KitPackage).dependsOn) {
        expect(layerOf.get(dep) ?? -1, `${id} → ${dep}`).toBeLessThan(layerOf.get(id) ?? -1);
      }
    }
  });

  it('has exactly one root, and it is core', () => {
    const roots = ids.filter((id) => (kit.packages[id] as KitPackage).dependsOn.length === 0);
    expect(roots).toEqual(['core']);
  });
});

describe('every package carries its own documentation', () => {
  it.each(ids)('%s states a purpose, an environment and at least one invariant', (id) => {
    const p = (kit.packages[id] as KitPackage);
    expect(p.purpose.length, 'purpose').toBeGreaterThan(40);
    expect(p.environment.length, 'environment').toBeGreaterThan(0);
    expect(p.invariants.length, 'invariants').toBeGreaterThanOrEqual(1);
    expect(p.modules.length, 'modules').toBeGreaterThanOrEqual(1);
  });
});
