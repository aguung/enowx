import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// TerminalView attaches xterm.js to the PTY WebSocket at /api/terminal. The
// sessionId keys a server-side PTY that survives refreshes: on reconnect the
// server replays this session's scrollback so the shell resumes as it was.
export function TerminalView({ sessionId, profile }: { sessionId: number; profile?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;

    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: "#0b0c10",
        foreground: "#d6ffe0",
        cursor: "#4ade80",
        selectionBackground: "#14532d",
        green: "#4ade80",
        brightGreen: "#86efac",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const q = `id=${sessionId}${profile ? `&profile=${encodeURIComponent(profile)}` : ""}`;
    const ws = new WebSocket(`${proto}://${window.location.host}/api/terminal?${q}`);
    ws.binaryType = "arraybuffer";

    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    ws.onopen = () => {
      // No banner: the server replays this session's scrollback on reconnect, so
      // the shell's own prompt/history is the signal that it's live. A banner
      // would print above the replayed history and look out of place.
      sendResize();
    };
    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) term.write(new Uint8Array(e.data));
      else term.write(e.data as string);
    };
    ws.onclose = () => term.writeln("\r\n\x1b[31m[session closed]\x1b[0m");
    ws.onerror = () => term.writeln("\r\n\x1b[31m[connection error]\x1b[0m");

    const dataSub = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data: d }));
    });

    const onResize = () => {
      fit.fit();
      sendResize();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host.current);

    return () => {
      ro.disconnect();
      dataSub.dispose();
      ws.close();
      term.dispose();
    };
  }, [sessionId, profile]);

  return (
    <div className="h-full w-full overflow-hidden bg-[#0b0c10] p-2">
      <div ref={host} className="h-full w-full" />
    </div>
  );
}
