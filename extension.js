/* exported init */

const { GObject } = imports.gi;

const Main = imports.ui.main;
const AppFavorites = imports.ui.appFavorites;
const Dash = imports.ui.dash;
const DND = imports.ui.dnd;
const AppDisplay = imports.ui.appDisplay;

const DashToPanelIconGTypeName = 'Gjs_dash-to-panel_jderose9_github_com_utils_DashToPanel_TaskbarAppIcon';

// dash shouldn't accept drop from appdisplay if app is already in dash (favourites)
class DashMod {
    constructor() {
        this._appFavorites = AppFavorites.getAppFavorites();
        this._unmod_getAppFromSource = Dash.getAppFromSource;
    }

    applyMod() {
        // this hack may not work in future, as getAppFromSource might not be exported outside file
        Dash.getAppFromSource = this.getAppFromSource.bind(this);
    }

    removeMod() {
        Dash.getAppFromSource = this._unmod_getAppFromSource;
    }

    getAppFromSource(source) {
        if (source instanceof Dash.DashIcon)
            return source.app;

        if (source instanceof AppDisplay.AppIcon) {
            // do not accept drop, if app is already in favorite
            if (this._appFavorites.isFavorite(source.app.get_id()))
                return null;
            return source.app;
        }

        return null;
    }
}

// appdisplay shouldn't accept drop from dash at all
// is app from dash is dropped onto appdisplay, remove it from dash
class AppdisplayMod {
    constructor(appDisplay) {
        this._appDisplay = appDisplay;

        this._appFavorites = AppFavorites.getAppFavorites();
        this._unmod_acceptDrop = this._appDisplay.acceptDrop.bind(this._appDisplay);
        this._unmod_connectDnD = this._appDisplay._connectDnD.bind(this._appDisplay);
    }

    applyMod() {
        this._appDisplay.acceptDrop = this.acceptDrop.bind(this);
        this._appDisplay._connectDnD = this._connectDnD.bind(this);
    }

    removeMod() {
        this._appDisplay.acceptDrop = this._unmod_acceptDrop;
        this._appDisplay._connectDnD = this._unmod_connectDnD;
    }

    _connectDnD() {
        this._unmod_connectDnD();
        if (this._appDisplay._dragBeginId > 0) {
            Main.overview.disconnect(this._appDisplay._dragBeginId);
            this._appDisplay._dragBeginId = Main.overview.connect('item-drag-begin', (overview, source) => {
                // do not accept drop into appdisplay from dash
                if (!(source instanceof Dash.DashIcon))
                    this._appDisplay._onDragBegin.call(this._appDisplay, overview, source);
            });
        }
    }

    acceptDrop(source) {
        if (source instanceof Dash.DashIcon || GObject.type_name(source) === DashToPanelIconGTypeName) {
            // drop is from dash, remove app
            if (this._appFavorites.isFavorite(source.id))
                this._appFavorites.removeFavorite(source.id);
            return DND.DragDropResult.SUCCESS;
        }
        return this._unmod_acceptDrop(source);
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

    connect(signal, callback) {
        return this._appFavorites.connect(signal, callback);
    }

    disconnect(id) {
        return this._appFavorites.disconnect(id);
    }
}

/// to change `_appFavorites` of AppFolders
class FolderViewMod {
    constructor(appDisplay) {
        this._appDisplay = appDisplay;
        this._appFavorites = new DummyAppFavorites();
        this._unmod_redisplay = AppDisplay.FolderView.prototype._redisplay;
    }

    applyMod() {
        this._changeFavorites(this._appFavorites);
    }

    removeMod() {
        this._changeFavorites(AppFavorites.getAppFavorites());
        AppDisplay.FolderView.prototype._redisplay = this._unmod_redisplay;
    }

    _changeFavorites(appFavorites) {
        const _unmod_redisplay = this._unmod_redisplay;
        AppDisplay.FolderView.prototype._redisplay = function (...args) {
            // `this` here is folderview
            this._appFavorites = appFavorites;
            _unmod_redisplay.call(this, ...args);
        };

        // to apply changes(change _appFavorites) for folders which are already created
        this._appDisplay._redisplay();
    }
}

class Extension {
    constructor() {
        this._mods = [];
        this._appDisplay = Main.overview._overview.controls._appDisplay;
    }

    enable() {
        this._mods = [
            new AppdisplayMod(this._appDisplay),
            new DashMod(),
            new FolderViewMod(this._appDisplay),
        ];

        this._appDisplay._appFavorites = new DummyAppFavorites();
        this._mods.forEach(mod => mod.applyMod());

        // redisplay after all mods are applied
        this._appDisplay._redisplay();
    }

    disable() {
        this._mods.reverse().forEach(mod => mod.removeMod());
        this._mods = [];

        // this returns singleton class
        this._appDisplay._appFavorites = AppFavorites.getAppFavorites();
        this._appDisplay._redisplay();
    }
}

function init() {
    return new Extension();
}
