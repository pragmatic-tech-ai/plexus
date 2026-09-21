import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeModulesPackageSource } from "../node-modules-package-source.js";
import { BuildManagerCompiler } from "../build-manager-compiler.js";

// A standalone meta-model project (no base bindings) compiles against the prelude alone,
// so an empty/absent node_modules source is sufficient.
function metaProject(): string
{
  const dir = mkdtempSync(join(tmpdir(), "plexus-compiler-"));
  writeFileSync(join(dir, "project.plexus"), JSON.stringify({ type: "meta-model", name: "widgets", version: 1, id: "widgets", modelVersion: "0.1.0" }));
  writeFileSync(join(dir, "model.todl"), "namespace acme { concept Widget { label : string?; } }");
  writeFileSync(join(dir, "README.md"), "# widgets");
  return dir;
}

test("compiles a project directory into <dir>/dist and returns the compiled package", async () => {
  const dir = metaProject();
  const compiler = new BuildManagerCompiler(new NodeModulesPackageSource(join(dir, "node_modules")));

  const result = await compiler.compile(dir);

  expect(result.ok).toBe(true);
  expect(result.package?.id).toBe("widgets");
  expect(result.package?.version).toBe("0.1.0");
  // The npm layout was promoted into <dir>/dist.
  expect(existsSync(join(dir, "dist", "model.json"))).toBe(true);
  expect(existsSync(join(dir, "dist", "package.json"))).toBe(true);
  const pj = JSON.parse(readFileSync(join(dir, "dist", "package.json"), "utf8"));
  expect(pj.todl.id).toBe("widgets");
  // Non-.todl project files are packed under resources/.
  expect(existsSync(join(dir, "dist", "resources", "README.md"))).toBe(true);
});

test("honours an explicit outDir", async () => {
  const dir = metaProject();
  const outDir = mkdtempSync(join(tmpdir(), "plexus-out-"));
  const compiler = new BuildManagerCompiler(new NodeModulesPackageSource(join(dir, "node_modules")));

  const result = await compiler.compile(dir, { outDir });

  expect(result.ok).toBe(true);
  expect(existsSync(join(outDir, "model.json"))).toBe(true);
});
