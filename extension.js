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

    this._injectionManager.overrideMethod(this._appDisplay, '_onDragMotion', this._createOnDragMotion.bind(this));
    this._injectionManager.overrideMethod(this._appDisplay, 'acceptDrop', this._createAcceptDrop.bind(this));

    this._reconnectDnD();
  }

  clear() {
    this._injectionManager.clear();
    this._reconnectDnD();
  }

  _reconnectDnD() {
    this._appDisplay._disconnectDnD();
    this._appDisplay._connectDnD();
  }

  _isDashIcon(source) {
    return source instanceof DashModule.DashIcon || GObject.type_name(source) === DashToPanelIconGTypeName;
  }

  _createOnDragMotion(originalMethod) {
    const mod = this;

    /** @this {AppDisplay.AppDisplay} */
    return function (dragEvent) {
      return originalMethod.call(mod._appDisplay, dragEvent);
    };
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
 * DummyAppFavorites - A proxy for AppFavorites that always returns false for isFavorite()
 *
 * This tricks GNOME Shell into displaying favorite apps in the app grid and folders
 * by making it think they are not favorites. This allows favorites to appear in both
 * the dash and the app grid simultaneously.
 */
class DummyAppFavorites {
  constructor() {
    this._appFavorites = AppFavorites.getAppFavorites();
  }

  isFavorite() {
    // Always return false to allow favorites to appear in app grid
    return false;
  }

  removeFavorite(id) {
    return this._appFavorites.removeFavorite(id);
  }
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
    this._dummyAppFavorites = new DummyAppFavorites();
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

export default class Extension {
  constructor() {
    this._mods = [];
    /** @type {AppDisplay.AppDisplay} */
    this._appDisplay = Main.overview._overview.controls.appDisplay;
  }

  enable() {
    this._mods = [new BaseAppViewMod(this._appDisplay), new AppDisplayMod(this._appDisplay), new DashMod()];
  }

  disable() {
    this._mods.reverse().forEach((mod) => mod.clear());
    this._mods = [];
  }
}
