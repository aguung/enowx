// Reusable WebOS context menu. A single global menu is rendered by the provider;
// any component opens it with useContextMenu().show(event, items). The browser's
// native menu is suppressed everywhere — editable fields get enowx Cut/Copy/Paste
// items instead, so right-click behaviour stays inside enowx.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Scissors, Copy, ClipboardPaste, TextCursorInput } from "lucide-react";
import { copyText } from "./clipboard";

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

interface ContextMenuAPI {
  // show opens the menu at the event position with the given items. Call
  // e.preventDefault() is handled internally.
  show: (e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void }, items: MenuItem[]) => void;
}

const Ctx = createContext<ContextMenuAPI | null>(null);

export function useContextMenu(): ContextMenuAPI {
  const api = useContext(Ctx);
  if (!api) throw new Error("useContextMenu must be used within ContextMenuProvider");
  return api;
}

// editableTarget returns the input/textarea/contenteditable under an event, or null.
function editableTarget(t: EventTarget | null): HTMLElement | null {
  const el = t as HTMLElement | null;
  if (!el) return null;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return el;
  return null;
}

async function pasteInto(el: HTMLElement) {
  try {
    const text = await navigator.clipboard.readText();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      el.value = el.value.slice(0, start) + text + el.value.slice(end);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    } else {
      document.execCommand("insertText", false, text);
    }
  } catch {
    /* clipboard blocked */
  }
}

// editItems builds Cut/Copy/Paste/Select-all for an editable field.
function editItems(el: HTMLElement): MenuItem[] {
  const isInput = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
  const selection = isInput ? el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0) : String(window.getSelection() ?? "");
  const hasSel = selection.length > 0;
  return [
    {
      label: "Cut",
      icon: <Scissors className="h-3.5 w-3.5" />,
      disabled: !hasSel,
      onClick: async () => {
        try {
          await copyText(selection);
        } catch { /* ignore */ }
        if (isInput) {
          const i = el as HTMLInputElement;
          const s = i.selectionStart ?? 0, e = i.selectionEnd ?? 0;
          i.value = i.value.slice(0, s) + i.value.slice(e);
          i.dispatchEvent(new Event("input", { bubbles: true }));
        }
      },
    },
    {
      label: "Copy",
      icon: <Copy className="h-3.5 w-3.5" />,
      disabled: !hasSel,
      onClick: () => { void copyText(selection); },
    },
    {
      label: "Paste",
      icon: <ClipboardPaste className="h-3.5 w-3.5" />,
      onClick: () => { el.focus(); pasteInto(el); },
    },
    {
      label: "Select all",
      icon: <TextCursorInput className="h-3.5 w-3.5" />,
      onClick: () => {
        if (isInput) (el as HTMLInputElement).select();
      },
    },
  ];
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const show = useCallback<ContextMenuAPI["show"]>((e, items) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  // Global handler: suppress the native menu everywhere. Editable fields fall
  // back to enowx Cut/Copy/Paste; other areas without a custom menu show nothing.
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      // A component that called show() has already preventDefault'd; this global
      // listener only fires for areas that didn't handle it themselves.
      if (e.defaultPrevented) return;
      e.preventDefault();
      const el = editableTarget(e.target);
      if (el) {
        setMenu({ x: e.clientX, y: e.clientY, items: editItems(el) });
      } else {
        setMenu(null);
      }
    };
    // Use bubble phase so component-level onContextMenu (which calls show) runs first.
    document.addEventListener("contextmenu", onCtx);
    return () => document.removeEventListener("contextmenu", onCtx);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  // Clamp the menu inside the viewport.
  const pos = menu ? clamp(menu.x, menu.y, ref.current) : { left: 0, top: 0 };

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {menu && menu.items.length > 0 && (
        <div
          ref={ref}
          style={{ left: pos.left, top: pos.top }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          className="fixed z-[100000] min-w-[160px] overflow-hidden rounded-lg border border-white/10 bg-[#14161d] p-1 text-white shadow-2xl"
        >
          {menu.items.map((it, i) =>
            it.separator ? (
              <div key={i} className="my-1 h-px bg-white/10" />
            ) : (
              <button
                key={i}
                disabled={it.disabled}
                onClick={() => {
                  setMenu(null);
                  it.onClick?.();
                }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors disabled:opacity-30 ${
                  it.danger ? "text-red-300 hover:bg-red-500/15" : "text-white/85 hover:bg-white/10"
                }`}
              >
                {it.icon ?? <span className="w-3.5" />}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}

function clamp(x: number, y: number, el: HTMLElement | null) {
  const w = el?.offsetWidth ?? 180;
  const h = el?.offsetHeight ?? 200;
  return {
    left: Math.min(x, window.innerWidth - w - 8),
    top: Math.min(y, window.innerHeight - h - 8),
  };
}
