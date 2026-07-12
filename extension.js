/*
 * Keep Pinned Apps in AppGrid  (pinned-apps-in-appgrid@brunosilva.io)
 * https://github.com/brunos3d/pinned-apps-in-appgrid
 *
 * A GNOME Shell extension that keeps favorite/pinned applications visible in the
 * AppGrid (and inside folders) while they also remain in the Dash/Dock. Since
 * GNOME 40 the Shell hides favorites from the grid; this extension restores them
 * there without disturbing the Dash or an auto-hide dock layout.
 *
 * Licensed under the GNU General Public License v3.0. See the LICENSE file.
 *
 *
 * ARCHITECTURE
 * ------------
 * Extension.enable() installs a list of small, independent "mods". Each mod patches
 * one or more GNOME Shell methods through InjectionManager (or connects a signal) in
 * its constructor and fully undoes that work in clear(). disable() clears the mods in
 * reverse order, so every behavior change stays isolated and individually reversible.
 *
 *   BaseAppViewMod    - the core trick: makes favorites render in the grid and folders.
 *   AppDisplayMod     - dropping a dash icon onto the grid unpins it (drag to remove).
 *   DashMod           - dragging a grid icon onto the dash never creates a duplicate.
 *   DockVisibilityMod - keeps an auto-hide dock visible for the duration of a drag.
 *
 * The extension leans on GNOME Shell *private* internals (_appFavorites, _redisplay,
 * _folderIcons, getAppFromSource, the Dash/AppIcon classes, ...). These are unstable
 * across Shell versions, so enable() is wrapped in a try/catch that rolls back cleanly
 * if one of them is missing on a future release. Supported versions live in
 * metadata.json.
 */

/* exported Extension */

import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as DashModule from 'resource:///org/gnome/shell/ui/dash.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as ExtensionModule from 'resource:///org/gnome/shell/extensions/extension.js';

// GType name of Dash to Panel's taskbar icons. They are not instances of the Shell's
// DashIcon, so drag sources coming from a Dash to Panel taskbar can only be recognized
// by their registered GObject type name. Used by AppDisplayMod._isDashIcon().
const DashToPanelIconGTypeName = 'Gjs_dash-to-panel_jderose9_github_com_appIcons_TaskbarAppIcon';

/**
 * DashMod - Controls what a drag source resolves to when dropped on the Dash.
 *
 * The Dash turns a drag source into an app through the static Dash.getAppFromSource();
 * handleDragOver()/acceptDrop() then use that app to reorder or pin favorites. Because
 * this extension puts favorite icons into the AppGrid too, a favorite can now be
 * dragged from the grid onto the dash, which natively would add a second copy of an app
 * that is already pinned.
 *
 * The override:
 *   - lets DashIcon sources through unchanged, so reordering existing dash icons works;
 *   - returns null for an AppGrid AppIcon whose app is already a favorite, blocking the
 *     duplicate; a non-favorite grid icon still resolves normally so it can be pinned;
 *   - falls back to the original behavior for any other source.
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
 * AppDisplayMod - Unpins an app when its dash icon is dropped onto the AppGrid.
 *
 * Dropping a dash icon on the grid is GNOME's native gesture for removing a favorite.
 * The Shell implements it in AppDisplay.acceptDrop() by checking
 * `this._appFavorites.isFavorite(source.id)`. BaseAppViewMod replaces that
 * _appFavorites with a proxy whose isFavorite() always returns false, which
 * (intentionally) makes favorites render in the grid but also disables the native
 * unpin. This mod restores the unpin by consulting the *real* AppFavorites instead.
 *
 * It intentionally overrides only acceptDrop(): the drop delegate is resolved fresh by
 * the DND machinery on every drop, and the grid's own drag-motion handler is re-bound
 * on every drag, so nothing here needs to reconnect the AppDisplay's DnD signals.
 */
class AppDisplayMod {
  /**
   * @param {AppDisplay.AppDisplay} appDisplay
   */
  constructor(appDisplay) {
    this._appDisplay = appDisplay;
    // The real, unproxied favorites model, so unpin actually mutates the dock.
    this._appFavorites = AppFavorites.getAppFavorites();
    this._injectionManager = new ExtensionModule.InjectionManager();

    this._injectionManager.overrideMethod(this._appDisplay, 'acceptDrop', this._createAcceptDrop.bind(this));
  }

  clear() {
    this._injectionManager.clear();
  }

  // True when the drag originates from a dock: the Shell's own DashIcon, or a
  // Dash to Panel taskbar icon (matched by GType name since it is not a DashIcon).
  _isDashIcon(source) {
    return source instanceof DashModule.DashIcon || GObject.type_name(source) === DashToPanelIconGTypeName;
  }

  _createAcceptDrop(originalMethod) {
    const mod = this;
    const appFavorites = this._appFavorites;

    /** @this {AppDisplay.AppDisplay} */
    return function (source) {
      if (mod._isDashIcon(source)) {
        // Dropped from the dock onto the grid: unpin it from favorites. Checked
        // against the real model because the grid's _appFavorites is proxied.
        if (appFavorites.isFavorite(source.id)) {
          appFavorites.removeFavorite(source.id);
        }
        return DND.DragDropResult.SUCCESS;
      }

      // Not a dock icon (e.g. moving/reordering a grid icon): keep native behavior.
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
 * BaseAppViewMod - The core trick: makes favorites appear in the grid and folders.
 *
 * The Shell excludes favorites from the AppGrid inside _loadApps() by testing
 * _appFavorites.isFavorite(). By overriding _redisplay() on both AppDisplay and
 * FolderView to swap in the createDummyAppFavorites() proxy (isFavorite() -> false)
 * just before the original runs, the exclusion filter never removes anything, so
 * favorites render in the grid and inside folders while still living in the dash.
 *
 * It also forces every folder icon to regenerate its preview after redisplay. Without
 * that, a favorite added to a folder would show when the folder is opened but not in
 * the small 2x2 preview thumbnail on the folder's icon (issue #3).
 *
 * clear() swaps the reference back to the real AppFavorites and redisplays once, so the
 * grid returns to stock behavior before the method overrides are removed.
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
