# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A GNOME Shell extension (UUID `pinned-apps-in-appgrid@brunosilva.io`) that makes favorite/pinned apps appear in the AppGrid *and* folders, while keeping them in the Dash. Since GNOME 40, favorites show only in the dock; this extension restores them to the grid without disturbing an existing Dash-to-Dock layout.

All logic lives in `extension.js`. `types.d.ts` provides hand-written ambient declarations for the private GNOME Shell modules (`resource:///org/gnome/shell/...`) used for editor type-checking only — it is not compiled or shipped.

## Build & install

```bash
make            # pack + install (runs the two targets below)
make pack       # gnome-extensions pack --force  -> produces *.shell-extension.zip
make update     # gnome-extensions install --force *.shell-extension.zip
```

After installing, log out/in (or restart GNOME Shell) and enable via `gnome-extensions enable pinned-apps-in-appgrid@brunosilva.io`. There is no test suite, linter, or build step beyond `gnome-extensions pack`. The Makefile auto-prefixes commands with `flatpak-spawn --host` when `FLATPAK_ID` is set.

Supported shell versions and the version number are declared in `metadata.json`; bump `version` (an integer) when releasing.

## Architecture

`Extension.enable()` installs a list of "mod" objects, each of which patches GNOME Shell methods via `InjectionManager.overrideMethod` (or connects a signal) and undoes it in `clear()`. `disable()` reverses the list and clears each — order matters, so preserve the reverse-on-disable pattern. `enable()` fetches `appDisplay` fresh (not in the constructor) and wraps mod construction in a `try/catch` that rolls back via `disable()` if a private symbol is missing on a new Shell version.

- **`BaseAppViewMod`** — the core trick. It overrides `_redisplay` on both `AppDisplay` and `FolderView` prototypes to swap the instance's `_appFavorites` for the **`createDummyAppFavorites()`** proxy just before the original runs. The proxy wraps the real `AppFavorites` singleton and delegates everything except `isFavorite()`, which always returns `false`. GNOME hides favorites from the grid because it thinks they're favorites; lying makes them render in both places. After redisplay it calls `folderIcon.icon.update()` on every folder icon so favorites also appear in the 2×2 folder *preview* thumbnails (fix for issue #3). (The proxy is a full wrapper, not a partial stand-in, so a future Shell calling any other `AppFavorites` method on it won't throw.)
- **`DashMod`** — overrides `Dash.getAppFromSource` so dragging an app from the grid onto the dash doesn't create a duplicate favorite (returns `null` when the app is already a favorite), while still allowing rearrangement of existing dash icons (`DashIcon` sources pass through).
- **`AppDisplayMod`** — overrides only the AppDisplay's `acceptDrop` so dragging a dash icon onto the grid removes it from favorites (unpins). This re-implements native behavior that `BaseAppViewMod` disables (the native path checks the now-proxied `_appFavorites.isFavorite()`), so it consults the **real** `AppFavorites`. Detects dash-origin drags including Dash-to-Panel via the GType name constant `DashToPanelIconGTypeName`. It deliberately does **not** touch `_connectDnD`/`_disconnectDnD` — the drop delegate and drag-motion handler are resolved fresh by the Shell each drag, so no reconnect is needed (a previous `_reconnectDnD` did this and caused a first-drag reordering bug + leaked signal connections).
- **`DockVisibilityMod`** — connects to `Main.overview` `item-drag-begin`/`item-drag-end`/`item-drag-cancelled` and, for the duration of a drag, sets `requiresVisibility = true` on any auto-hide dock's dash so it stays visible while reordering. Feature-detected via the dock dash's `_requireVisibility()` method (Dash to Dock / Dash to Panel have it; the vanilla dash does not, so it no-ops on stock GNOME). Restores the prior value on drag end. This is the only mod that reaches toward third-party dock internals, and it touches only the public-by-convention `requiresVisibility` flag.

Key coupling to be aware of: this extension depends on GNOME Shell **private** internals (`_appFavorites`, `_redisplay`, `_folderIcons`, `getAppFromSource`, the `Dash`/`AppIcon`/`DashIcon` classes) and the docks' `requiresVisibility` convention. These are unstable across shell versions — adding support for a new GNOME release usually means verifying these method names/shapes still exist, then adding the version string to `metadata.json`.
