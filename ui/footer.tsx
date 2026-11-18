import { useEffect, useState } from "react";
import type { PluginSlotComponentApi } from "@yomni/contracts";
import { IconButton } from "@yomni/ui/primitives";
import { SquareLibrary, Pin, PinOff } from "@yomni/ui/icons";
import { Tooltip } from "@yomni/ui/tooltip";
import { useUi } from "@yomni/ui";

export default function BootFooter({
  api,
  projectId,
  sessionId,
  expanded = true,
}: {
  api: PluginSlotComponentApi;
  projectId?: string;
  sessionId?: string;
  expanded?: boolean;
}) {
  const { locale } = useUi();
  const t = (english: string, chinese: string) =>
    locale.startsWith("zh") ? chinese : english;
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const scope = {
    ...(projectId ? { projectId } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
  useEffect(() => {
    let alive = true;
    let channel: string | undefined;
    let revision = 0;
    setReady(false);
    const refresh = async () => {
      const current = ++revision;
      try {
        const state = await api.services.call<{ pinned: boolean }>(
          "footer",
          "snapshot",
          {},
          { scope },
        );
        if (alive && current === revision) {
          setPinned(state.pinned);
          setReady(true);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    };
    void (async () => {
      try {
        const opened = await api.services.open({
          alias: "footer",
          method: "changed",
          kind: "subscription",
          scope,
        });
        channel = opened.id;
        if (!alive) return;
        await refresh();
        while (alive) {
          const next = await api.services.next(opened.id);
          if (next.done) break;
          await refresh();
        }
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (channel) void api.services.close(channel).catch(() => {});
      }
    })();
    return () => {
      alive = false;
      if (channel) void api.services.close(channel).catch(() => {});
    };
  }, [api.services, projectId, sessionId]);
  const act = async (method: string) => {
    setBusy(true);
    try {
      await api.services.call("footer", method, {}, { scope });
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const library = t("Intro library", "片头片库");
  const pin = pinned
    ? t("Unpin conversation intro", "取消会话片头")
    : t("Pin conversation intro", "固定会话片头");
  const error = t(
    "Unable to update the intro. Try again.",
    "片头操作未完成，请重试。",
  );
  return (
    <div style={{ display: "flex", flexDirection: expanded ? "row" : "column", gap: 4 }}>
      <Tooltip content={failed ? error : library}>
        <IconButton
          variant="ghost"
          size="icon"
          aria-label={library}
          disabled={busy}
          style={{ width: 28, height: 28, minWidth: 28, minHeight: 28, padding: 0 }}
          onClick={() => void act("library")}
        >
          <SquareLibrary size={15} aria-hidden />
        </IconButton>
      </Tooltip>
      <Tooltip
        content={
          failed
            ? error
            : !sessionId
              ? t(
                  "Select a conversation to pin its intro",
                  "选择会话后可固定片头",
                )
              : pin
        }
      >
        <IconButton
          variant="ghost"
          size="icon"
          aria-label={pin}
          aria-pressed={pinned}
          disabled={busy || !ready || !sessionId}
          style={{ width: 28, height: 28, minWidth: 28, minHeight: 28, padding: 0 }}
          onClick={() => void act("pin")}
        >
          {pinned ? (
            <PinOff size={15} aria-hidden />
          ) : (
            <Pin size={15} aria-hidden />
          )}
        </IconButton>
      </Tooltip>
    </div>
  );
}
