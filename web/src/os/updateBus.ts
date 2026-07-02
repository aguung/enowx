import { useEffect, useState } from "react";
import { versionApi, type VersionInfo } from "../lib/api";

// updateBus polls the gateway's version endpoint (which compares the running
// build to the latest GitHub release) and exposes update state + an apply action.
let info: VersionInfo = { current: "", update_available: false };
let loaded = false;
let updating = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

async function refresh() {
  try {
    info = await versionApi.get();
    loaded = true;
    emit();
  } catch {
    /* offline / rate-limited — keep last */
  }
}

// applyUpdate triggers the self-update, then polls /api/version until the new
// version answers (the gateway restarts mid-flight).
export async function applyUpdate(): Promise<void> {
  updating = true;
  emit();
  try {
    await versionApi.update();
  } catch {
    updating = false;
    emit();
    throw new Error("couldn't start the update");
  }
  // Poll for the gateway to come back on the new version.
  const target = info.latest;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const v = await versionApi.get();
      if (v.current !== info.current || v.current === target) {
        info = v;
        updating = false;
        emit();
        // Reload the UI to pick up the new build.
        location.reload();
        return;
      }
    } catch {
      /* still restarting */
    }
  }
  updating = false;
  emit();
}

export interface UpdateState {
  info: VersionInfo;
  updating: boolean;
  loaded: boolean;
}

export function useUpdate(): UpdateState {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (!loaded) refresh();
    const iv = setInterval(refresh, 30 * 60 * 1000); // every 30 min
    return () => {
      listeners.delete(l);
      clearInterval(iv);
    };
  }, []);
  return { info, updating, loaded };
}
