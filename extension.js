/*
 * This file is part of https://github.com/brunos3d/pinned-apps-in-appgrid.
 * It is a modified version of https://gitlab.gnome.org/harshadgavali/favourites-in-appgrid.
 * This project is licensed under the GNU General Public License v3.0.
 */

/* exported Extension */

import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as DashModule from 'resource:///org/gnome/shell/ui/dash.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as ExtensionModule from 'resource:///org/gnome/shell/extensions/extension.js';

const DashToPanelIconGTypeName = 'Gjs_dash-to-panel_jderose9_github_com_appIcons_TaskbarAppIcon';

/**
 * DashMod - Handles drag and drop behavior for the Dash
 *
 * Prevents duplicate favorite apps from being added to the dash when dragging
 * from the app grid. Allows rearranging icons within the dash itself.
 */
class DashMod {
  constructor() {
    this._appFavorites = AppFavorites.getAppFavorites();
    this._injectionManager = new ExtensionModule.InjectionManager();

    this._injectionManager.overrideMethod(DashModule.Dash, 'getAppFromSource', this._createGetAppFromSource.bind(this));
  }

  clear() {
    this._injectionManager.clear();
  }

  _createGetAppFromSource(originalMethod) {
    const appFavorites = this._appFavorites;

    /** @this {DashModule.Dash} */
    return function (source) {
      // Allow rearranging icons within the Dash
      if (source instanceof DashModule.DashIcon) {
        return source.app;
      }

      // Block duplicate additions to Dash when source is from AppDisplay
      if (source instanceof AppDisplay.AppIcon) {
        if (appFavorites.isFavorite(source.app.get_id())) {
          return null; // Block duplicate addition
        }
        return source.app;
      }

      // Default behavior for other sources
      return originalMethod.call(this, source);
    };
  }
}

/**
 * AppDisplayMod - Handles drag and drop behavior for the AppDisplay
 *
 * When apps from the dash are dropped onto the app display, they are removed
 * from favorites (unpinned from the dash).
 */
class AppDisplayMod {
  /**
   * @param {AppDisplay.AppDisplay} appDisplay
   */
  constructor(appDisplay) {
    this._appDisplay = appDisplay;
    this._appFavorites = AppFavorites.getAppFavorites();
    this._injectionManager = new ExtensionModule.InjectionManager();

    this._injectionManager.overrideMethod(this._appDisplay, 'acceptDrop', this._createAcceptDrop.bind(this));
  }

  clear() {
    this._injectionManager.clear();
  }

  _isDashIcon(source) {
    return source instanceof DashModule.DashIcon || GObject.type_name(source) === DashToPanelIconGTypeName;
  }

  _createAcceptDrop(originalMethod) {
    const mod = this;
    const appFavorites = this._appFavorites;

    /** @this {AppDisplay.AppDisplay} */
    return function (source) {
      if (mod._isDashIcon(source)) {
        // If drop is from dash, remove app from favorites
        if (appFavorites.isFavorite(source.id)) {
          appFavorites.removeFavorite(source.id);
        }
        return DND.DragDropResult.SUCCESS;
      }

      return originalMethod.call(this, source);
    };
  }
}

/**
 * createDummyAppFavorites - Wraps the real AppFavorites singleton in a Proxy that
 * reports every app as NOT a favorite (isFavorite() -> false) while transparently
 * delegating every other property and method to the real instance.
 *
 * This tricks GNOME Shell into displaying favorite apps in the app grid and folders
 * (both hide anything isFavorite() reports as true) without hiding them from the dash.
 *
 * Wrapping instead of replacing is deliberate: a partial stand-in that only implements
 * isFavorite()/removeFavorite() would throw the moment the Shell called any other
 * AppFavorites method on it during redisplay. Delegating everything keeps it correct
 * across Shell versions; only isFavorite() is intercepted.
 */
function createDummyAppFavorites() {
  const appFavorites = AppFavorites.getAppFavorites();

  return new Proxy(appFavorites, {
    get(target, prop, receiver) {
      if (prop === 'isFavorite')
        return () => false;

      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * BaseAppViewMod - Modifies AppDisplay and FolderView to show favorite apps
 *
 * This is the core of the extension. It:
 * 1. Replaces the _appFavorites reference with DummyAppFavorites
 * 2. Forces folder icon previews to update after redisplay
 *
 * Without the folder icon update, favorite apps would appear inside folders when opened,
 * but would not show in the folder preview icons (the small 2x2 grid on folder icons).
 */
class BaseAppViewMod {
  /**
   * @param {AppDisplay.AppDisplay} appDisplay
   */
  constructor(appDisplay) {
    this._appDisplay = appDisplay;
    /** @type {AppFavorites.IAppFavorites} */
    this._dummyAppFavorites = createDummyAppFavorites();
    this._injectionManager = new ExtensionModule.InjectionManager();

    // Override _redisplay for both FolderView and AppDisplay
    this._injectionManager.overrideMethod(AppDisplay.FolderView.prototype, '_redisplay', this._createFolderRedisplay.bind(this));
    this._injectionManager.overrideMethod(AppDisplay.AppDisplay.prototype, '_redisplay', this._createRedisplay.bind(this));

    // Trigger initial redisplay with dummy favorites
    this._appDisplay._redisplay();
  }

  clear() {
    // Restore original appFavorites behavior
    this._dummyAppFavorites = AppFavorites.getAppFavorites();
    this._appDisplay._redisplay();

    this._injectionManager.clear();
  }

  _createRedisplay(originalMethod) {
    const mod = this;

    /** @this {AppDisplay.AppDisplay} */
    return function () {
      // Replace _appFavorites with dummy to show favorites in app grid
      this._appFavorites = mod._dummyAppFavorites;

      // Call original _redisplay to populate the grid
      originalMethod.call(this);

      // Fix for issue #3: Folder icon previews not showing favorite apps
      // After _redisplay updates _orderedItems in each FolderView, we need to
      // force each FolderIcon to regenerate its preview to reflect the new items.
      //
      // The flow is:
      // 1. FolderView._redisplay() updates _orderedItems (includes favorites now)
      // 2. FolderIcon.icon.update() calls _createIconTexture()
      // 3. _createIconTexture() calls createIcon()
      // 4. FolderIcon.createIcon() calls view.createFolderIcon()
      // 5. createFolderIcon() uses _orderedItems to generate the preview grid
      if (this._folderIcons) {
        this._folderIcons.forEach((folderIcon) => {
          if (folderIcon && folderIcon.icon) {
            folderIcon.icon.update();
          }
        });
      }
    };
  }

  _createFolderRedisplay(originalMethod) {
    const mod = this;

    /** @this {AppDisplay.FolderView} */
    return function () {
      // Replace _appFavorites with dummy to show favorites in folders
      this._appFavorites = mod._dummyAppFavorites;

      // Call original _redisplay to populate the folder
      originalMethod.call(this);
    };
  }
}

/**
 * DockVisibilityMod - Keeps auto-hide docks visible while an item is being dragged.
 *
 * Vanilla GNOME's dash lives only in the overview and never auto-hides, so this is a
 * no-op there. Auto-hide docks (Dash to Dock, and Dash to Panel which derives from it)
 * decide their own visibility from a `requiresVisibility` flag on their dash. Some
 * versions fail to set it during a drag (e.g. Dash to Dock intellihide re-evaluates
 * mid-drag as the drag actor overlaps the dock), so the dock hides while the user is
 * still dragging and reordering onto it becomes impossible.
 *
 * We set that flag for the duration of the drag and restore it afterwards. It only
 * touches the `requiresVisibility` convention, gated behind feature detection (the
 * presence of the dock's own `_requireVisibility()` method), and never reaches into a
 * dock's private layout/animation internals. When no auto-hide dock is present it does
 * nothing.
 */
class DockVisibilityMod {
  constructor() {
    this._changed = [];
    this._overviewIds = [
      Main.overview.connect('item-drag-begin', this._onDragBegin.bind(this)),
      Main.overview.connect('item-drag-end', this._onDragEnd.bind(this)),
      Main.overview.connect('item-drag-cancelled', this._onDragEnd.bind(this)),
    ];
  }

  clear() {
    this._overviewIds.forEach((id) => Main.overview.disconnect(id));
    this._overviewIds = [];
    // Drop any pending overrides without restoring: on disable the dock owns its
    // own visibility again, and a drag can't be in progress across disable().
    this._changed = [];
  }

  /**
   * Candidate dash objects, from the most stable Shell paths, that belong to an
   * auto-hide dock. Deduplicated. The vanilla dash is filtered out because it has no
   * `_requireVisibility()` method and does not auto-hide.
   */
  _dockDashes() {
    const candidates = [Main.overview?.dash, Main.overview?._overview?.controls?.dash];

    const seen = new Set();
    return candidates.filter((dash) => {
      if (!dash || seen.has(dash) || typeof dash._requireVisibility !== 'function') {
        return false;
      }
      seen.add(dash);
      return true;
    });
  }

  _onDragBegin() {
    // Guard against a missed drag-end leaving stale state.
    this._onDragEnd();

    for (const dash of this._dockDashes()) {
      this._changed.push([dash, dash.requiresVisibility]);
      dash.requiresVisibility = true;
    }
  }

  _onDragEnd() {
    for (const [dash, previous] of this._changed) {
      try {
        dash.requiresVisibility = previous;
      } catch {
        // The dock may have been destroyed mid-drag (e.g. monitor change); ignore.
      }
    }
    this._changed = [];
  }
}

export default class Extension {
  constructor() {
    this._mods = [];
    /** @type {AppDisplay.AppDisplay} */
    this._appDisplay = null;
  }

  enable() {
    // Fetch the appDisplay at enable() time rather than in the constructor:
    // the extension can be enabled/disabled several times per session and the
    // Shell may recreate the appDisplay, so a reference cached once can go stale.
    this._appDisplay = Main.overview._overview.controls.appDisplay;
    this._mods = [];

    try {
      this._mods.push(new BaseAppViewMod(this._appDisplay));
      this._mods.push(new AppDisplayMod(this._appDisplay));
      this._mods.push(new DashMod());
      this._mods.push(new DockVisibilityMod());
    } catch (e) {
      // If any patch fails (e.g. a private Shell API changed on a new Shell
      // version), roll back everything already applied instead of leaving the
      // Shell in a half-patched state.
      logError(e, 'pinned-apps-in-appgrid: failed to enable, rolling back');
      this.disable();
    }
  }

  disable() {
    this._mods.reverse().forEach((mod) => mod.clear());
    this._mods = [];
    this._appDisplay = null;
  }
}
