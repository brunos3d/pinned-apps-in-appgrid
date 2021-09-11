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

class Extension {
    constructor() {
        this._appDisplay = Main.overview._overview.controls._appDisplay;
    }

    enable() {
        this._mods = [
            new AppdisplayMod(this._appDisplay),
            new DashMod(),
        ];

        this._appDisplay._appFavorites = new DummyAppFavorites();
        this._appDisplay._redisplay();

        this._mods.forEach(mod => mod.applyMod());
    }

    disable() {
        this._mods.reverse().forEach(mod => mod.removeMod());

        // this returns singleton class
        this._appDisplay._appFavorites = AppFavorites.getAppFavorites();
        this._appDisplay._redisplay();
    }
}

function init() {
    return new Extension();
}
