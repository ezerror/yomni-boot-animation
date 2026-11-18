import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { ClipStore } from "../src/store.js";

const require = createRequire(import.meta.url);
const plugin = require("../dist/index.cjs");

test("startup, library actions and ranged built-in video use declared Yomni UI", async () => {
  const storagePath = await mkdtemp(join(tmpdir(), "yomni-boot-animation-"));
  const controller = new AbortController();
  let invalidations = 0;
  let pickedFiles = null;
  let confirmDelete = false;
  try {
    const contributions = await plugin.activate({
      storagePath,
      resourcePath: resolve("."),
      signal: controller.signal,
      invalidateUi: () => { invalidations++; },
      public: () => ({
        picker: { files: async () => pickedFiles },
        dialog: { confirm: async () => confirmDelete },
      }),
    });
    const overlay = contributions.ui.find((item) => item.slot === "yomni.window.overlay");
    const controls = contributions.slotContributions.find((item) => item.id === "yomni.boot-animation.controls");
    assert.ok(overlay);
    assert.ok(controls);
    const context = { signal: controller.signal };
    const request = { id: overlay.id, mountId: "mount-1", projectId: "project-1", sessionId: "", locale: "zh-CN" };
    const first = await overlay.render(request, context);
    assert.equal(first.hidden, false);
    assert.match(first.surface.html, /Yomni/);
    const endpoint = first.surface.html.match(/http:\/\/127\.0\.0\.1:\d+\/boot\/[a-f0-9]{48}/)?.[0];
    assert.ok(endpoint);
    const response = await fetch(endpoint + "/media/builtin-brand", { headers: { Range: "bytes=0-31" } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.equal(Buffer.from(await response.arrayBuffer()).toString("ascii", 4, 8), "ftyp");
    assert.equal((await fetch(endpoint + "/media/builtin-unknown")).status, 404);
    await overlay.act({ id: "skip" }, context, request);
    assert.equal((await overlay.render(request, context)).hidden, true);
    assert.deepEqual(controls.target, { kind: "yomni.app-shell.sidebar-footer-view", version: 1 });
    const footer = contributions.services["yomni.boot-animation.footer"];
    const footerContext = { ...context, callerAuthority: {
      signal: controller.signal, available: () => true,
      grantedPermissions: ["yomni.storage.read", "yomni.storage.write"],
    } };
    await footer.methods.library.call({}, footerContext);
    assert.match((await overlay.render(request, context)).surface.html, /片头片库/);
    pickedFiles = [resolve("media/deepseek-brand-intro.mp4")];
    await overlay.act({ id: "upload" }, context, request);
    const store = new ClipStore(storagePath);
    const imported = (await store.clips()).find(clip => clip.writable);
    assert.ok(imported);
    assert.equal(imported.name, "deepseek-brand-intro.mp4");
    const importedVideo = await fetch(endpoint + "/media/" + imported.id, { headers: { Range: "bytes=0-31" } });
    assert.equal(importedVideo.status, 206);
    assert.equal(Buffer.from(await importedVideo.arrayBuffer()).toString("ascii", 4, 8), "ftyp");
    await overlay.act({ id: "delete", value: imported.id }, context, request);
    assert.ok((await store.clips()).some(clip => clip.id === imported.id));
    confirmDelete = true;
    await overlay.act({ id: "delete", value: imported.id }, context, request);
    assert.equal((await store.clips()).some(clip => clip.id === imported.id), false);
    await overlay.act({ id: "select", value: "builtin-brand" }, context, request);
    const library = await overlay.render(request, context);
    assert.match(library.surface.html, /builtin-brand/);
    await overlay.act({ id: "preview", value: "builtin-brand" }, context, request);
    assert.match((await overlay.render(request, context)).surface.html, /media\//);
    await overlay.act({ id: "ended" }, context, request);
    assert.match((await overlay.render(request, context)).surface.html, /片头片库/);
    assert.ok(invalidations >= 4);
    let changes = 0;
    const stop = footer.events.changed.subscribe(() => changes++, footerContext);
    const session = { ...footerContext, sessionId: "session-1" };
    assert.equal((await footer.methods.snapshot.call({}, session)).pinned, false);
    await footer.methods.pin.call({}, session);
    assert.equal((await footer.methods.snapshot.call({}, session)).pinned, true);
    assert.equal((await footer.methods.snapshot.call({}, { ...session, sessionId: "session-2" })).pinned, false);
    await overlay.act({ id: "pin" }, context, { ...request, sessionId: "session-1" });
    assert.equal((await footer.methods.snapshot.call({}, session)).pinned, false);
    assert.equal(changes, 2);
    stop();
    await assert.rejects(footer.methods.pin.call({}, { ...session, callerAuthority: { ...session.callerAuthority, grantedPermissions: [] } }), { code: "PERMISSION" });
  } finally {
    controller.abort();
    await rm(storagePath, { recursive: true, force: true });
  }
});
