import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const plugin = require("../dist/index.cjs");

test("startup, library actions and ranged built-in video use declared Yomni UI", async () => {
  const storagePath = await mkdtemp(join(tmpdir(), "pal-boot-animation-"));
  const controller = new AbortController();
  let invalidations = 0;
  try {
    const contributions = await plugin.activate({
      storagePath,
      resourcePath: resolve("."),
      signal: controller.signal,
      invalidateUi: () => { invalidations++; },
      public: () => ({
        picker: { files: async () => null },
        dialog: { confirm: async () => false },
      }),
    });
    const overlay = contributions.ui.find((item) => item.slot === "pal.window.overlay");
    const controls = contributions.ui.find((item) => item.slot === "pal.sidebar.footer.action");
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
    await controls.act({ id: "library" }, context, { ...request, id: controls.id });
    assert.match((await overlay.render(request, context)).surface.html, /片头片库/);
    await overlay.act({ id: "select", value: "builtin-brand" }, context, request);
    const library = await overlay.render(request, context);
    assert.match(library.surface.html, /builtin-brand/);
    await overlay.act({ id: "preview", value: "builtin-brand" }, context, request);
    assert.match((await overlay.render(request, context)).surface.html, /media\//);
    await overlay.act({ id: "ended" }, context, request);
    assert.match((await overlay.render(request, context)).surface.html, /片头片库/);
    assert.ok(invalidations >= 4);
  } finally {
    controller.abort();
    await rm(storagePath, { recursive: true, force: true });
  }
});
