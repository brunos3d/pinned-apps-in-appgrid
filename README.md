# Pinned Apps in AppGrid

## Overview

Starting with GNOME 40, favorite applications are only displayed in the dock. This extension brings them back to the application grid — and into app folders — so your pinned/favorite apps stay visible in both places, without interfering with your existing Dash or Dash-to-Dock layout.

https://github.com/user-attachments/assets/3b9a1c6c-a341-4e5f-accd-0d69b5a299c9

## Background

This extension addresses long-standing pain points around rearranging favorite apps in both the GNOME Dock and the GNOME Application Grid:

- [Dash-to-Dock issue #2010](https://github.com/micheleg/dash-to-dock/issues/2010)
- [Dash-to-Dock issue #2122](https://github.com/micheleg/dash-to-dock/issues/2122)

## Features

- Shows your pinned/favorite apps in the Application Grid **and** inside app folders, while keeping them in the dock.
- Never creates duplicate favorites when you drag a grid icon onto the dock.
- Unpin an app by dragging its dock icon onto the grid, exactly like native GNOME.
- Keeps auto-hide docks (Dash to Dock / Dash to Panel) visible while you drag, so reordering is never interrupted.
- Preserves your dock layout and leaves the grid's ordering entirely to GNOME.
- Works on stock GNOME as well as with Dash to Dock and Dash to Panel.

## How it works

The extension is intentionally small and reversible: `enable()` installs a set of independent "mods", each of which patches one GNOME Shell behavior and fully undoes it on `disable()`.

- **Favorites in the grid & folders.** GNOME hides favorites from the grid by checking `AppFavorites.isFavorite()`. The extension wraps the real favorites model in a lightweight proxy that reports "not a favorite" only during the grid's redisplay, so favorites render in the grid and folders (including the small 2×2 folder previews) while the dock keeps using the real model. Your favorites data is never modified or duplicated.
- **No duplicate pins.** Dragging a grid icon that is already pinned onto the dock is ignored instead of adding a second copy.
- **Drag to unpin.** Dropping a dock icon onto the grid removes it from favorites, restoring the native gesture (which the proxy above would otherwise disable).
- **Dock stays visible while dragging.** Auto-hide docks are kept on screen for the duration of a drag — via the dock's own `requiresVisibility` flag — so reordering favorites is never cut short. This is a no-op on the stock GNOME dash, which doesn't auto-hide.

The grid's ordering stays entirely under GNOME's control; the extension never reorders apps for you. It relies on GNOME Shell private internals, so `enable()` rolls back cleanly if a future Shell release changes something it depends on.

## Compatibility

- GNOME Shell 45–50 (see `metadata.json` for the current list).
- Works with the stock GNOME dash, **Dash to Dock**, and **Dash to Panel**.

## Installation

### 1. Easy Way

Go and grab it from GNOME Extensions

https://extensions.gnome.org/extension/7660/keep-pinned-apps-in-appgrid/

[<img src="https://github.com/andyholmes/gnome-shell-extensions-badge/raw/master/get-it-on-ego.png" width="175">](https://extensions.gnome.org/extension/7660/keep-pinned-apps-in-appgrid/)

### 2. DIY Locally

1.  Clone the repository:

```bash
git clone https://github.com/brunos3d/pinned-apps-in-appgrid.git
cd pinned-apps-in-appgrid
```

2.  Build the extension:

```bash
make
```

## License

This project is licensed under the GPL License. See the LICENSE file for details.
