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

// dash shouldn't accept drop from appdisplay if app is already in dash (favourites)
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
      // Permitir rearranjo de ícones dentro do Dash
      if (source instanceof DashModule.DashIcon) {
        return source.app; // Retorna o app para permitir o rearranjo
      }

      // Bloquear adição duplicada ao Dash apenas se a origem for AppDisplay
      if (source instanceof AppDisplay.AppIcon) {
        if (appFavorites.isFavorite(source.app.get_id())) {
          return null; // Bloqueia adição duplicada
        }
        return source.app;
      }

      // Comportamento padrão para outras fontes
      return originalMethod.call(this, source);
    };
  }
}

// appdisplay shouldn't accept drop from dash at all
// if app from dash is dropped onto appdisplay, remove it from dash
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
      // do nothing if item was dragged from dash
      // if (mod._isDashIcon(dragEvent.source)) return DND.DragDropResult.CONTINUE;
      return originalMethod.call(mod._appDisplay, dragEvent);
    };
  }

  _createAcceptDrop(originalMethod) {
    const mod = this;
    const appFavorites = this._appFavorites;

    /** @this {AppDisplay.AppDisplay} */
    return function (source) {
      if (mod._isDashIcon(source)) {
        // drop is from dash, remove app
        if (appFavorites.isFavorite(source.id)) appFavorites.removeFavorite(source.id);
        return DND.DragDropResult.SUCCESS;
      }

      return originalMethod.call(this, source);
    };
  }
}

// dummy app favourites tracker
// always says app is not favourite
// used in appdisplay to populate appdisplay with favourites as well
class DummyAppFavorites {
  constructor() {
    this._appFavorites = AppFavorites.getAppFavorites();
  }

  isFavorite() {
    return false;
  }

  removeFavorite(id) {
    return this._appFavorites.removeFavorite(id);
  }
}

/// to change `_appFavorites` of AppFolders
class BaseAppViewMod {
  /**
   * @param {AppDisplay.AppDisplay} appDisplay
   */
  constructor(appDisplay) {
    this._appDisplay = appDisplay;
    /** @type {AppFavorites.IAppFavorites} */
    this._dummyAppFavorites = new DummyAppFavorites();
    this._injectionManager = new ExtensionModule.InjectionManager();

    this._injectionManager.overrideMethod(AppDisplay.FolderView.prototype, '_redisplay', this._createRedisplay.bind(this));
    this._injectionManager.overrideMethod(AppDisplay.AppDisplay.prototype, '_redisplay', this._createRedisplay.bind(this));
    this._appDisplay._redisplay();
  }

  clear() {
    // change appFavorites to default
    this._dummyAppFavorites = AppFavorites.getAppFavorites();
    this._appDisplay._redisplay();

    this._injectionManager.clear();
  }

  _createRedisplay(originalMethod) {
    const mod = this;

    /** @this {AppDisplay.FolderView | AppDisplay.AppDisplay} */
    return function () {
      this._appFavorites = mod._dummyAppFavorites;
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
