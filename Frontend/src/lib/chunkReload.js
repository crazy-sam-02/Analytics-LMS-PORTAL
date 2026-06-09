const RELOAD_STORAGE_KEY = "lms_dynamic_import_reload";

const isDynamicImportFailure = (error) => {
  const message = String(error?.message || error || "");
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("error loading dynamically imported module")
  );
};

const reloadOnceForFreshAssets = () => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const lastReload = Number(window.sessionStorage.getItem(RELOAD_STORAGE_KEY) || 0);
    const now = Date.now();

    if (now - lastReload < 30000) {
      return;
    }

    window.sessionStorage.setItem(RELOAD_STORAGE_KEY, String(now));
  } catch {
    // Reload even if sessionStorage is blocked.
  }

  window.location.reload();
};

export const registerChunkReloadHandler = () => {
  if (typeof window === "undefined") {
    return;
  }

  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadOnceForFreshAssets();
  });

  window.addEventListener("error", (event) => {
    if (isDynamicImportFailure(event.error)) {
      reloadOnceForFreshAssets();
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (isDynamicImportFailure(event.reason)) {
      event.preventDefault();
      reloadOnceForFreshAssets();
    }
  });
};
