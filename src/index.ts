import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { assertServiceCallPermissions, definePlugin, type PluginModule } from "@yomni/plugin-sdk";
import { ClipStore } from "./store.js";
import { overlaySurface, type LibrarySnapshot } from "./surface.js";

type Clip = LibrarySnapshot["clips"][number];
type Settings = LibrarySnapshot["settings"];
type Overlay = { mode: "video" | "library"; clipId: string | null; returnToLibrary: boolean } | null;
const CLIP_ID = /^(?:[a-f0-9-]{36}|file-[a-f0-9]{32}|builtin-(?:brand|cyberpunk|awakening|startup)|manual-intro|environment|default)$/;
const settingKeys = new Set(["playOnAppStart", "randomPlayback", "fitMode"]);
const mediaPath = /^\/media\/(?:[a-f0-9-]{36}|file-[a-f0-9]{32}|builtin-(?:brand|cyberpunk|awakening|startup)|manual-intro|environment)$/;

export const activate: PluginModule["activate"] = async (host) => {
  const store = new ClipStore(host.storagePath, join(host.resourcePath ?? resolve(__dirname, ".."), "media"));
  const mount = `/boot/${randomBytes(24).toString("hex")}`;
  const server = createServer(async (request, response) => {
    const address = server.address();
    const expectedHost = address && typeof address !== "string" ? `127.0.0.1:${address.port}` : "";
    if (request.headers.host !== expectedHost || !request.url?.startsWith(mount + "/")) {
      response.writeHead(403).end();
      return;
    }
    const path = new URL(request.url, "http://127.0.0.1").pathname.slice(mount.length);
    if (request.method !== "GET" || !mediaPath.test(path)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("X-Content-Type-Options", "nosniff");
    try {
      await store.stream(path.slice(7), request.headers.range, response);
    } catch {
      if (!response.headersSent) response.writeHead(404).end();
      else response.destroy();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("片头视频服务无法启动。");
  const endpoint = `http://127.0.0.1:${address.port}${mount}`;
  host.signal.addEventListener("abort", () => server.close(), { once: true });

  let overlay: Overlay = null;
  let startupPlayed = false;
  let lastRandomClip: string | null = null;
  let message = "";
  const mounted = new Set<string>();
  const footerListeners = new Set<(value: unknown) => void>();
  const refresh = () => {
    host.invalidateUi?.();
    for (const emit of footerListeners) emit(null);
  };
  host.signal.addEventListener("abort", () => footerListeners.clear(), { once: true });
  const snapshot = async (sessionId: string): Promise<LibrarySnapshot> => ({
    clips: await store.clips() as Clip[],
    settings: await store.settings() as Settings,
    sessionId,
    message,
  });
  const choose = (library: LibrarySnapshot, sessionId: string): string | null => {
    const { clips, settings } = library;
    const override = settings.conversationOverrides[sessionId];
    if (override && clips.some((clip) => clip.id === override)) return override;
    if (settings.randomPlayback && clips.length) {
      const options = clips.filter((clip) => clip.id !== lastRandomClip);
      const pool = options.length ? options : clips;
      lastRandomClip = pool[Math.floor(Math.random() * pool.length)]!.id;
      return lastRandomClip;
    }
    if (settings.selectedClipId === "default") return null;
    if (settings.selectedClipId && clips.some((clip) => clip.id === settings.selectedClipId))
      return settings.selectedClipId;
    return clips.find((clip) => clip.id === "environment")?.id
      ?? clips.find((clip) => clip.id === "manual-intro")?.id
      ?? clips.find((clip) => clip.writable || clip.id.startsWith("file-"))?.id
      ?? null;
  };
  const play = (clipId: string | null, returnToLibrary = false) => {
    overlay = { mode: "video", clipId, returnToLibrary };
    refresh();
  };
  const finish = () => {
    overlay = overlay?.returnToLibrary
      ? { mode: "library", clipId: null, returnToLibrary: false }
      : null;
    refresh();
  };
  const report = (text: string) => { message = text; refresh(); };

  return definePlugin((yomni) => {
    yomni.slots.contribute({
      id: "yomni.boot-animation.controls",
      target: { kind: "yomni.app-shell.sidebar-footer-view", version: 1 },
      content: {
        component: { module: "footer", export: "default" },
        props: {},
        order: 40,
      },
      commands: [],
    });
    yomni.ui.register({
      id: "yomni.boot-animation.overlay",
      slot: "yomni.window.overlay",
      requiredPermissions: ["yomni.storage.read", "yomni.storage.write"],
      actions: ["skip", "ended", "close", "preview", "play", "select", "override", "pin", "setting", "upload", "delete"],
      async render(request) {
        const library = await snapshot(request.sessionId);
        if (request.mountId && !mounted.has(request.mountId)) {
          mounted.add(request.mountId);
          const pinned = !!request.sessionId && library.settings.pinnedSessions.includes(request.sessionId);
          if (pinned && overlay?.mode !== "library")
            play(choose(library, request.sessionId));
          else if (!overlay && library.settings.playOnAppStart && !startupPlayed)
            play(choose(library, request.sessionId));
          startupPlayed = true;
        }
        return {
          title: "片头动画",
          children: [],
          hidden: !overlay,
          ...(overlay ? { surface: { html: overlaySurface({ mode: overlay.mode, clipId: overlay.clipId, endpoint, snapshot: library }) } } : {}),
        };
      },
      async act(action, context, request) {
        if (action.id === "skip" || action.id === "ended") return finish();
        if (action.id === "close") { overlay = null; refresh(); return; }
        try {
          const library = await snapshot(request.sessionId);
          const settings = library.settings;
          if (action.id === "play") play(choose(library, request.sessionId), true);
          else if (action.id === "preview") {
            if (!action.value || !CLIP_ID.test(action.value)) throw new Error("invalid clip");
            play(action.value === "default" ? null : action.value, true);
          } else if (action.id === "select") {
            if (!action.value || !CLIP_ID.test(action.value)) throw new Error("invalid clip");
            await store.save({ ...settings, selectedClipId: action.value });
            report("已设为全局片头。");
          } else if (action.id === "override" && request.sessionId) {
            if (action.value && !CLIP_ID.test(action.value)) throw new Error("invalid clip");
            const conversationOverrides = { ...settings.conversationOverrides };
            if (action.value) conversationOverrides[request.sessionId] = action.value;
            else delete conversationOverrides[request.sessionId];
            await store.save({ ...settings, conversationOverrides });
            report(action.value ? "已为当前会话指定片头。" : "当前会话已恢复全局片头。");
          } else if (action.id === "pin" && request.sessionId) {
            const pinnedSessions = new Set(settings.pinnedSessions);
            if (pinnedSessions.has(request.sessionId)) pinnedSessions.delete(request.sessionId);
            else pinnedSessions.add(request.sessionId);
            await store.save({ ...settings, pinnedSessions: [...pinnedSessions] });
            refresh();
          } else if (action.id === "setting") {
            const input = JSON.parse(action.value ?? "null") as { key?: string; value?: unknown } | null;
            if (!input?.key || !settingKeys.has(input.key)) throw new Error("invalid setting");
            if (input.key === "fitMode" ? !["cover", "contain"].includes(String(input.value)) : typeof input.value !== "boolean")
              throw new Error("invalid value");
            await store.save({ ...settings, [input.key]: input.value });
            refresh();
          } else if (action.id === "upload") {
            const files = await host.public?.(context).picker.files({ title: "选择片头视频", multiple: true });
            if (!files?.length) return;
            for (const file of files) {
              const info = await stat(file);
              if (!info.isFile() || info.size < 1 || info.size > 100 * 1024 * 1024)
                throw new Error("invalid size");
              await store.upload(basename(file), await readFile(file));
            }
            report(`已导入 ${files.length} 个视频。`);
          } else if (action.id === "delete") {
            if (!action.value || !library.clips.some((clip) => clip.id === action.value && clip.writable))
              throw new Error("invalid clip");
            const confirmed = await host.public?.(context).dialog.confirm({
              title: "删除片头视频",
              description: "从片库删除这个视频？",
              confirmText: "删除",
              tone: "danger",
            });
            if (confirmed) {
              await store.remove(action.value);
              report("视频已删除。");
            }
          }
        } catch {
          report("操作未完成，请检查视频文件或重试。");
        }
      },
      unmount(request) {
        if (request.mountId) mounted.delete(request.mountId);
      },
    });
    return {
      services: {
        "yomni.boot-animation.footer": {
          contract: "yomni.boot-animation.footer",
          apiVersion: 1,
          transport: "clone",
          methods: {
            snapshot: {
              requiredPermissions: ["yomni.storage.read"],
              async call(_input, context) {
                assertServiceCallPermissions(context, ["yomni.storage.read"], { readOnly: true });
                const settings = await store.settings() as Settings;
                return { pinned: !!context.sessionId && settings.pinnedSessions.includes(context.sessionId) };
              },
            },
            library: {
              requiredPermissions: ["yomni.storage.read"],
              async call(_input, context) {
                assertServiceCallPermissions(context, ["yomni.storage.read"]);
                overlay = { mode: "library", clipId: null, returnToLibrary: false };
                message = "";
                refresh();
              },
            },
            pin: {
              requiredPermissions: ["yomni.storage.read", "yomni.storage.write"],
              async call(_input, context) {
                assertServiceCallPermissions(context, ["yomni.storage.read", "yomni.storage.write"]);
                if (!context.sessionId) return;
                const settings = await store.settings() as Settings;
                const pinnedSessions = new Set(settings.pinnedSessions);
                if (pinnedSessions.has(context.sessionId)) pinnedSessions.delete(context.sessionId);
                else pinnedSessions.add(context.sessionId);
                await store.save({ ...settings, pinnedSessions: [...pinnedSessions] });
                refresh();
              },
            },
          },
          events: {
            changed: {
              requiredPermissions: ["yomni.storage.read"],
              subscribe(emit, context) {
                assertServiceCallPermissions(context, ["yomni.storage.read"], { readOnly: true });
                footerListeners.add(emit);
                return () => { footerListeners.delete(emit); };
              },
            },
          },
        },
      },
    };
  }).activate(host);
};
