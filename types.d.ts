declare module 'gi://GObject' {
    const GObject = {
        type_name: (obj: unknown) => string,
    }

    export default GObject;
}

declare module 'resource:///org/gnome/shell/ui/main.js' {
    import { AppDisplay } from "resource:///org/gnome/shell/ui/appDisplay.js";

    export const overview = {
        _overview: {
            controls: {
                appDisplay: AppDisplay.prototype
            }
        }
    };
}

declare module 'resource:///org/gnome/shell/ui/appFavorites.js' {
    interface IAppFavorites {
        isFavorite(id: string): boolean,
        removeFavorite(id: string): void,
    }
    export function getAppFavorites(): IAppFavorites;
}

declare module 'resource:///org/gnome/shell/ui/dash.js' {
    export class DashIcon extends AppIcon {}
    export class Dash {
        static getAppFromSource(source: unknown): unknown;
    }
}

declare module 'resource:///org/gnome/shell/ui/dnd.js' {
    export enum DragDropResult  {
        SUCCESS,
        CONTINUE
    };
}

declare module 'resource:///org/gnome/shell/ui/appDisplay.js' {
    import { IAppFavorites } from "resource:///org/gnome/shell/ui/appFavorites.js";

    export class AppIcon {
        app: {
            get_id: () => string;
        }
    }

    export class AppDisplay {
        _appFavorites: IAppFavorites;
        _disconnectDnD(): void;
        _connectDnD(): void;
        _redisplay(): void;
        _onDragBegin(overview: unknown, source: unknown): void;
        _onDragMotion(dragEvent: unknown): void;
        acceptDrop(source: unknown): void;
    }
    
    export class FolderView {
        _appFavorites: IAppFavorites;
        _redisplay(): void;
    }
}

declare module 'resource:///org/gnome/shell/extensions/extension.js' {

    export class InjectionManager {
        overrideMethod<T, K extends keyof T>(obj: T, name: K, callback: Function): void;
        clear(): void;
    };
}