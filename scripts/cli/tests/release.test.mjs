import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

// Exercise release orchestration with real directories and ZIP files, replacing
// expensive builds/downloads so the tests do not need platform binaries.
const source = fs.readFileSync(new URL("../cli.mjs", import.meta.url), "utf8")
  .replace(/^#!.*\n/, "")
  .replace(/^import .*;\n/gm, "")
  .split("\nmain().catch(")[0];
const hasZip = spawnSync("zip", ["-v"]).status === 0 &&
  spawnSync("unzip", ["-v"]).status === 0;

function releaseContext(t, goos) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "javboss-release-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "go.mod"), "module test\n");
  const context = vm.createContext({
    fs, fsp, os, path, spawn,
    console: { log() {}, error() {} },
    process: { ...process, argv: [process.execPath, path.join(root, "cli.mjs")], exitCode: 0 },
    calls: [], goos,
  });
  vm.runInContext(source + `
    globalThis.choice = PLATFORM_CHOICES.find(p => p.goos === goos);
    globalThis.outDir = path.join(ROOT_DIR, 'release', 'javboss-test-' + choice.label);
    globalThis.zipPath = outDir + '.zip';
    isBundledFfprobeReady = async () => true;
    isBundledMpvReady = async () => true;
    isBundledFfmpegReady = async () => { calls.push('check-ffmpeg'); return true; };
    buildWeb = async () => {};
    copyDir = async () => {};
    buildBackendRelease = async (_, dir) => fsp.writeFile(path.join(dir, 'javboss'), 'server');
    copyBundledFfprobe = async () => {};
    copyBundledFfmpeg = async (_, dir) => {
      calls.push('bundle-ffmpeg');
      await fsp.writeFile(path.join(dir, ffmpegBinName(goos)), 'ffmpeg');
    };
    copyBundledMpv = async () => {};
    copyModernZAssets = async () => {};
    createReleaseConfig = async () => {};
    createMacCommandLauncher = async () => {};
    downloadFfprobe = async () => calls.push('download-ffprobe');
    downloadFfmpeg = async () => calls.push('download-ffmpeg');
    downloadMpv = async () => calls.push('download-mpv');
    globalThis.cli = { runRelease, createZip, createZipWithPython, downloadDependencies, handleRelease };
  `, context);
  return context;
}

for (const goos of ["windows", "linux"]) {
  test(`${goos} releases omit FFmpeg even when rebuilding an old ZIP`, { skip: !hasZip }, async (t) => {
    const ctx = releaseContext(t, goos);
    // Simulate an existing release with the formerly bundled FFmpeg.
    const oldBinary = path.join(ctx.outDir, "internal", "bin", goos === "windows" ? "ffmpeg.exe" : "ffmpeg");
    await fsp.mkdir(path.dirname(oldBinary), { recursive: true });
    await fsp.writeFile(oldBinary, "old ffmpeg");
    await ctx.cli.createZip(ctx.outDir, ctx.zipPath);
    await ctx.cli.handleRelease("test", `${goos}/amd64`);
    assert.equal(ctx.process.exitCode, 0);
    assert.equal(ctx.calls.length, 0, "must neither check nor bundle FFmpeg");
    const result = spawnSync("unzip", ["-Z1", ctx.zipPath], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\/javboss\n/);
    assert.doesNotMatch(result.stdout, /\/ffmpeg(?:\.exe)?\n/);
  });

  test(`${goos} dependency downloads skip FFmpeg`, async (t) => {
    const ctx = releaseContext(t, goos);
    await ctx.cli.downloadDependencies(ctx.choice);
    assert.equal(ctx.calls.join(","), "download-ffprobe,download-mpv");
  });
}

test("macOS still downloads and bundles FFmpeg", { skip: !hasZip }, async (t) => {
  const ctx = releaseContext(t, "darwin");
  await ctx.cli.downloadDependencies(ctx.choice);
  await ctx.cli.runRelease(ctx.choice, "test");
  assert.equal(ctx.process.exitCode, 0);
  assert.equal(ctx.calls.join(","), "download-ffprobe,download-ffmpeg,download-mpv,check-ffmpeg,bundle-ffmpeg");
  assert.equal(await fsp.readFile(path.join(ctx.outDir, "ffmpeg"), "utf8"), "ffmpeg");
});

// 没有 zip 命令的 Linux 上会走 python 回退。这里直接调回退实现，
// 断言两件事：内容齐全，以及**执行位被显式写进 zip**。
// 后者是关键 —— 发布目录常在 NTFS/DrvFs 上，stat 拿到的权限不可信。
function findPythonSync() {
  for (const candidate of ["python3", "python"]) {
    const probe = spawnSync(candidate, ["-V"]);
    if (probe.status === 0) return candidate;
  }
  return "";
}
const pythonCmd = findPythonSync();

test("python zip fallback writes unix exec bits", { skip: !pythonCmd }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "javboss-zip-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outDir = path.join(root, "javboss-test-linux-x86_64");
  const zipPath = path.join(root, "javboss-test-linux-x86_64.zip");

  const files = {
    "javboss": "server",
    "javboss.command": "launcher",
    "web/dist/index.html": "<!doctype html>",
    "web-mobile/dist/index.html": "<!doctype html>",
    "internal/bin/ffprobe": "probe",
    "internal/bin/mpv/mpv": "player",
    "config.toml": "port = 8655",
  };
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(outDir, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, content);
  }

  const context = vm.createContext({
    fs, fsp, os, path, spawn,
    console: { log() {}, error() {} },
    process: { ...process, argv: [process.execPath, "cli.mjs"], exitCode: 0 },
    calls: [], goos: "linux",
  });
  vm.runInContext(source + `
    globalThis.createZipWithPython = createZipWithPython;
    globalThis.findPython = findPython;
  `, context);
  assert.equal(await context.findPython(), pythonCmd, "findPython 必须跳过不可用的 python3 占位程序");
  await context.createZipWithPython(pythonCmd, outDir, zipPath);

  // 用 python 读回 zip 里的权限位，断言不依赖 unzip 的可用性
  const inspect = spawnSync(pythonCmd, ["-c", `
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as zf:
    out = {}
    for info in zf.infolist():
        name = info.filename.rstrip("/")
        out[name] = {
            "mode": (info.external_attr >> 16) & 0o777,
            "dir": info.is_dir(),
            "body": "" if info.is_dir() else zf.read(info).decode(),
        }
print(json.dumps(out, sort_keys=True))
`, zipPath], { encoding: "utf8" });
  assert.equal(inspect.status, 0, inspect.stderr);
  const raw = JSON.parse(inspect.stdout);
  // zip 里的条目路径带顶层目录名（和 `zip -rq out.zip baseName` 的行为一致）
  const prefix = "javboss-test-linux-x86_64/";
  const entries = {};
  for (const [key, value] of Object.entries(raw)) {
    entries[key.startsWith(prefix) ? key.slice(prefix.length) : key] = value;
  }

  const actualKeys = Object.keys(entries).sort();
  // 目录条目也要在（`zip -r` 同样会写目录条目），所以这里逐条列全。
  const expectedKeys = [
    "config.toml",
    "internal",
    "internal/bin",
    "internal/bin/ffprobe",
    "internal/bin/mpv",
    "internal/bin/mpv/mpv",
    "javboss",
    "javboss.command",
    "web",
    "web-mobile",
    "web-mobile/dist",
    "web-mobile/dist/index.html",
    "web/dist",
    "web/dist/index.html",
  ].sort();
  assert.deepEqual(actualKeys, expectedKeys, `zip 内容清单，实际：${JSON.stringify(actualKeys)}`)
  assert.equal(entries["javboss"].mode, 0o755, "javboss 必须有执行位");
  assert.equal(entries["javboss.command"].mode, 0o755, "macOS 启动器必须有执行位");
  assert.equal(entries["internal/bin/ffprobe"].mode, 0o755, "内置 ffprobe 必须有执行位");
  assert.equal(entries["internal/bin/mpv/mpv"].mode, 0o755, "内置 mpv 必须有执行位");
  assert.equal(entries["config.toml"].mode, 0o644, "普通文件是 0644");
  assert.equal(entries["web/dist/index.html"].mode, 0o644);
  assert.equal(entries["web-mobile/dist/index.html"].mode, 0o644);
  assert.equal(entries["web-mobile/dist/index.html"].body, "<!doctype html>");
  assert.equal(entries["web-mobile/dist"].dir, true, "目录条目要保留");
});
