import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// TerminalView attaches xterm.js to the PTY WebSocket at /api/terminal.
export function TerminalView() {
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

    // The PTY shell is loopback-only on the server (it exposes your machine).
    // When the UI is reached over a tunnel/remote host the WebSocket would be
    // refused with a cryptic error — explain it instead of trying.
    if (!isLocalHost(window.location.hostname)) {
      term.writeln("\x1b[33mTerminal is available on localhost only.\x1b[0m");
      term.writeln("");
      term.writeln("\x1b[90mFor safety the shell (and file browser) are not served\x1b[0m");
      term.writeln("\x1b[90mover a public tunnel or remote host. Open enowx locally\x1b[0m");
      term.writeln("\x1b[90mat http://localhost:1430 to use the terminal.\x1b[0m");
      return () => {
        term.dispose();
      };
    }

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/api/terminal`);
    ws.binaryType = "arraybuffer";

    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    ws.onopen = () => {
      term.writeln("\x1b[32mconnected to enx shell\x1b[0m");
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
  }, []);

  return (
    <div className="h-full w-full overflow-hidden bg-[#0b0c10] p-2">
      <div ref={host} className="h-full w-full" />
    </div>
  );
}

// isLocalHost mirrors the server's loopback guard: the terminal only connects
// when the UI itself is served from localhost.
function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.startsWith("127.");
}
