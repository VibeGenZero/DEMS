/**
 * Types of the DEMS plugin SDK: `ctx` (server.js, `register(ctx)`) and `ui`
 * (client.js, `register(ui)`). The plugin studio loads this file into the
 * editor for completion; `test/pluginTypes.test.js` keeps it equal to the
 * real objects. Keep one member per line (`name(...)` or `name: Type;`) so
 * that test can read it. `@permission` names the manifest permission a member needs.
 */
declare namespace DemsPlugin {
    /** Ein Event in der Plugin-Form (ohne Check-in-Code). Weitere gespeicherte Felder sind möglich. */
    interface PluginEvent {
        /** Event-ID. */
        id: string;
        /** Titel. */
        title: string;
        /** Beschreibung (Markdown). */
        description: string;
        /** Status: draft, active, archived oder cancelled. */
        status: 'draft' | 'active' | 'archived' | 'cancelled';
        /** Beginn als ISO-Text oder ''. */
        startDate: string;
        /** Ende als ISO-Text oder ''. */
        endDate: string;
        /** Anmeldeschluss als ISO-Text oder ''. */
        registrationDeadline?: string;
        /** Abmeldeschluss als ISO-Text oder ''. */
        unregisterDeadline?: string;
        /** Maximale Teilnehmerzahl, 0 = unbegrenzt. */
        maxParticipants: number;
        /** Kategorie. */
        category?: string;
        /** Ort. */
        location?: { text: string; channelId?: string; channelType?: string } | null;
        /** Banner-Adresse. */
        bannerUrl?: string;
        /** Akzentfarbe als Hex-Wert. */
        accentColor?: string;
        /** Rollen-Slots des Events. */
        slots?: Array<{ id: string; name: string; emoji: string; capacity: number }>;
        /** Plugin, das das Event angelegt hat ({ plugin, ref }), sonst null. */
        origin: { plugin: string; ref: string } | null;
        [field: string]: unknown;
    }

    /** Eine Anmeldung in der Plugin-Form (ohne Formularantworten und Gäste). */
    interface PluginRegistration {
        /** Anmelde-ID. */
        id: string;
        /** Event-ID. */
        eventId: string;
        /** Discord-ID des Mitglieds. */
        userId: string;
        /** Status der Anmeldung (z. B. accepted, pending, waitlist). */
        status: string;
        /** Herkunft der Anmeldung (web, discord) oder null. */
        source: string | null;
        /** Zeitpunkt der Anmeldung (ISO) oder null. */
        createdAt: string | null;
        /** Ob eingecheckt wurde. */
        checkedIn: boolean;
        /** Zeitpunkt des Check-ins (ISO) oder null. */
        checkedInAt: string | null;
        /** Gewählter Slot oder null. */
        slotId: string | null;
    }

    /** Ein Mitglied mit Name und Avatar. */
    interface PluginMember {
        /** Discord-ID. */
        id: string;
        /** Anzeigename. */
        name: string;
        /** Avatar-Adresse. */
        avatar: string;
    }

    /** Ein Dokument der Plugin-Daten: die Felder plus `id`. */
    interface PluginDocument {
        /** Dokument-ID. */
        id: string;
        [field: string]: unknown;
    }

    /** Der angemeldete Nutzer einer Route. */
    interface RouteUser {
        /** Discord-ID. */
        id: string;
        /** Anzeigename. */
        name: string;
        /** Avatar-Adresse. */
        avatar: string;
        /** Ob der Nutzer Admin ist. */
        isAdmin: boolean;
        /** Discord-Rollen-IDs. */
        roles: string[];
    }

    /** Was ein Routen-Handler bekommt. */
    interface RouteRequest {
        /** Der angemeldete Nutzer. */
        user: RouteUser;
        /** Pfad-Parameter (`:id`). */
        params: Record<string, string>;
        /** Query-Parameter. */
        query: Record<string, string | string[]>;
        /** JSON-Body (bei `password: true` ohne das Passwort). */
        body: any;
    }

    /** Optionen einer Route. */
    interface RouteOptions {
        /** Wer die Route aufrufen darf. Pflicht. */
        access: 'member' | 'admin';
        /** Nur mit access admin: prüft das Admin-Reset-Passwort aus dem Body. */
        password?: boolean;
    }

    /** Handler einer Route; der Rückgabewert wird als JSON gesendet. */
    type RouteHandler = (request: RouteRequest) => unknown;

    /** Ein Link-Button an einer Discord-Nachricht. */
    interface DiscordLink {
        /** Beschriftung, 1 bis 80 Zeichen. */
        label: string;
        /** Adresse auf diese DEMS-Seite (`ctx.events.url`, `ctx.siteUrl`). */
        url: string;
    }

    /** Eine Discord-Nachricht. */
    interface DiscordMessage {
        /** Text, 1 bis 2000 Zeichen, niemand wird gepingt. */
        text: string;
        /** Optionaler Link-Button. */
        link?: DiscordLink;
    }

    /** Eine Discord-Rolle, die ein Plugin vergeben darf. */
    interface DiscordRole {
        /** Rollen-ID. */
        id: string;
        /** Rollenname. */
        name: string;
        /** Farbe oder null. */
        color: string | null;
    }

    /** Ergebnis von addRole/removeRole. */
    type RoleResult = { ok: true; changed: boolean } | { ok: false; reason: string };

    /** Ein Profil-Badge. */
    interface ProfileBadge {
        /** ID, 1 bis 40 Zeichen aus Buchstaben, Ziffern und Bindestrich. */
        id: string;
        /** Name, 1 bis 40 Zeichen. */
        name: string;
        /** Beschreibung bis 200 Zeichen. */
        description?: string;
        /** Bootstrap-Icon (`bi-*`). */
        icon: string;
        /** Farbe als #rrggbb. */
        color?: string;
        /** Ob das Mitglied das Badge hat. */
        unlocked: boolean;
        /** Fortschritt von 0 bis 1. */
        progress?: number;
    }

    /** Plugin-Angaben des Servers. */
    interface ServerPluginInfo {
        /** Plugin-ID. */
        id: string;
        /** Version aus plugin.json. */
        version: string;
        /** Ob es ein offizielles Plugin ist. */
        official: boolean;
    }

    /** Logger mit dem Präfix `[plugin:<id>]`. */
    interface Logger {
        /** Schreibt eine Info-Zeile. */
        info(...args: unknown[]): void;
        /** Schreibt eine Warnung. */
        warn(...args: unknown[]): void;
        /** Schreibt einen Fehler. */
        error(...args: unknown[]): void;
    }

    /** Routen unter `/api/plugins/<id>`; nur während `register()` anmeldbar. */
    interface Routes {
        /** Meldet eine GET-Route an. */
        get(path: string, options: RouteOptions, handler: RouteHandler): void;
        /** Meldet eine POST-Route an. */
        post(path: string, options: RouteOptions, handler: RouteHandler): void;
        /** Meldet eine PUT-Route an. */
        put(path: string, options: RouteOptions, handler: RouteHandler): void;
        /** Meldet eine DELETE-Route an. */
        delete(path: string, options: RouteOptions, handler: RouteHandler): void;
    }

    /** Eigene Daten des Plugins (Sammlungsnamen `^[a-z][a-zA-Z0-9]{0,31}$`). */
    interface DataApi {
        /** Liest ein Dokument oder null. */
        get(coll: string, id: string): Promise<PluginDocument | null>;
        /** Liest alle Dokumente einer Sammlung. */
        list(coll: string): Promise<PluginDocument[]>;
        /** Filtert nach einem Feld (`==`, `!=`, `<`, `<=`, `>`, `>=`, `in`). */
        where(coll: string, field: string, op: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in', value: unknown): Promise<PluginDocument[]>;
        /** Legt ein Dokument mit neuer ID an. */
        add(coll: string, doc: object): Promise<PluginDocument>;
        /** Ersetzt ein Dokument. */
        set(coll: string, id: string, doc: object): Promise<PluginDocument>;
        /** Ändert Felder eines vorhandenen Dokuments (sonst Fehler). */
        update(coll: string, id: string, patch: object): Promise<PluginDocument>;
        /** Löscht ein Dokument. */
        delete(coll: string, id: string): Promise<void>;
    }

    /** Seiten-Design (Stylesheet) des Plugins. */
    interface ThemeApi {
        /**
         * Speichert einen Entwurf, sichtbar in der Vorschau.
         * @permission theme
         */
        saveDraft(css: string): Promise<void>;
        /**
         * Verwirft den Entwurf.
         * @permission theme
         */
        discardDraft(): Promise<void>;
        /**
         * Veröffentlicht das Stylesheet für alle.
         * @permission theme
         */
        publish(css: string): Promise<void>;
        /**
         * Entfernt das Stylesheet.
         * @permission theme
         */
        clear(): Promise<void>;
    }

    /** Einstellungen aus plugin.json. */
    interface SettingsApi {
        /** Liest die gespeicherten Werte (Geheimnisse inklusive, nie zurückgeben). */
        get(): Promise<Record<string, unknown>>;
    }

    /** Events lesen. */
    interface EventsApi {
        /**
         * Ein Event (jeder Status) oder null.
         * @permission events:read
         */
        get(eventId: string): Promise<PluginEvent | null>;
        /**
         * Alle Events nach Beginn sortiert; `upcoming` nur nicht beendete.
         * @permission events:read
         */
        list(options?: { upcoming?: boolean }): Promise<PluginEvent[]>;
        /** Link, der das Event in DEMS öffnet. */
        url(eventId: string): string;
    }

    /** Anmeldungen lesen (SDK 1.1). */
    interface RegistrationsApi {
        /**
         * Anmeldungen nach Zeitpunkt sortiert, gefiltert nach Event und/oder Mitglied.
         * @permission registrations:read
         */
        list(filter?: { eventId?: string; userId?: string }): Promise<PluginRegistration[]>;
    }

    /** Mitglieder lesen. */
    interface MembersApi {
        /**
         * Ein Mitglied oder null.
         * @permission members:read
         */
        get(userId: string): Promise<PluginMember | null>;
        /**
         * Bis zu 20 Mitglieder, deren Name den Suchtext (2 bis 50 Zeichen) enthält (SDK 1.1).
         * @permission members:read
         */
        search(query: string): Promise<PluginMember[]>;
    }

    /** Discord über den Bot, mit Limits. */
    interface DiscordApi {
        /**
         * Schickt eine Direktnachricht; true, wenn sie gesendet wurde.
         * @permission discord:dm
         */
        sendDM(userId: string, message: DiscordMessage): Promise<boolean>;
        /**
         * Postet in den Kanal einer eigenen `channel`-Einstellung (Schlüssel, nie eine Kanal-ID).
         * @permission discord:channel
         */
        sendChannelMessage(settingKey: string, message: DiscordMessage): Promise<boolean>;
        /**
         * Rollen, die ein Plugin vergeben darf (SDK 1.1).
         * @permission discord:roles
         */
        listRoles(): Promise<DiscordRole[]>;
        /**
         * Vergibt eine Rolle (SDK 1.1).
         * @permission discord:roles
         */
        addRole(userId: string, roleId: string): Promise<RoleResult>;
        /**
         * Entzieht eine Rolle (SDK 1.1).
         * @permission discord:roles
         */
        removeRole(userId: string, roleId: string): Promise<RoleResult>;
    }

    /** Hooks: der Kern ruft sie nach dem Speichern auf. */
    interface HooksApi {
        /** Meldet einen Handler an (nur während register()). Event-Hooks brauchen events:read, registration.checkedIn braucht registrations:read, member.deleted nichts. */
        on(name: 'event.created' | 'event.published' | 'event.ended' | 'event.cancelled', handler: (payload: { event: PluginEvent }) => void | Promise<void>): void;
        on(name: 'event.updated', handler: (payload: { event: PluginEvent; changed: string[] }) => void | Promise<void>): void;
        on(name: 'event.deleted', handler: (payload: { eventId: string; origin: { plugin: string; ref: string } | null }) => void | Promise<void>): void;
        on(name: 'member.deleted', handler: (payload: { userId: string }) => void | Promise<void>): void;
        on(name: 'registration.checkedIn', handler: (payload: { registration: PluginRegistration; eventId: string }) => void | Promise<void>): void;
    }

    /** Profil des Mitglieds (SDK 1.1). */
    interface ProfileApi {
        /** Meldet einmal, während register(), die Badges für das eigene Profil an (Antwort innerhalb von 2 s, höchstens 50). */
        badges(provider: (request: { userId: string }) => ProfileBadge[] | Promise<ProfileBadge[]>): void;
    }

    /** Das `ctx` von `register(ctx)` in server.js. */
    interface ServerContext {
        /** Angaben zum Plugin. */
        plugin: ServerPluginInfo;
        /** Logger. */
        log: Logger;
        /** Routen anmelden. */
        routes: Routes;
        /** Eigene Daten. */
        data: DataApi;
        /** Seiten-Design. */
        theme: ThemeApi;
        /** Einstellungen. */
        settings: SettingsApi;
        /** Events. */
        events: EventsApi;
        /** Anmeldungen. */
        registrations: RegistrationsApi;
        /** Mitglieder. */
        members: MembersApi;
        /** Discord. */
        discord: DiscordApi;
        /** Link `<BASE_URL>/#<hash>` auf eine DEMS-Seite, z. B. `ctx.siteUrl('p/<id>')`. */
        siteUrl(hash: string): string;
        /** Schreibt einen Audit-Log-Eintrag `plugin:<id>:<action>` (action `^[a-zA-Z0-9_.-]{1,64}$`). */
        audit(action: string, adminId: string, details: string, targetId?: string | null): Promise<void>;
        /** Hooks. */
        hooks: HooksApi;
        /** Profil. */
        profile: ProfileApi;
        /** Läuft, wenn ein Admin das Plugin ausschaltet (2 s). */
        onDisable(fn: () => void | Promise<void>): void;
        /** Fehler mit HTTP-Status und deutscher Meldung; mit `throw` aus einer Route. */
        httpError(status: number, message: string): Error;
    }

    /** Plugin-Angaben im Browser. */
    interface ClientPluginInfo {
        /** Plugin-ID. */
        id: string;
        /** Name aus plugin.json. */
        name: string;
        /** Version aus plugin.json. */
        version: string;
        /** Ob es ein offizielles Plugin ist. */
        official: boolean;
    }

    /** Der angemeldete Nutzer im Browser. */
    interface ClientUser {
        /** Discord-ID. */
        id: string;
        /** Anzeigename. */
        name: string;
        /** Avatar-Adresse. */
        avatar: string;
        /** Ob der Nutzer Admin ist. */
        isAdmin: boolean;
    }

    /** Die eine Seite des Plugins. */
    interface PageOptions {
        /** Wer die Seite sieht. */
        access: 'member' | 'admin';
        /** Seitentitel. */
        title: string;
        /** Füllt den Container (`param` aus `#p/<id>/<param>`); darf async sein. */
        render(container: HTMLElement, param?: string): void | Promise<void>;
        /** Läuft beim Verlassen der Seite. */
        leave?(): void;
        /** Navigationseintrag: Beschriftung bis 30 Zeichen, Icon `bi-*`. */
        tab?: { label: string; icon: string };
    }

    /** Aktionen für `data-click`/`data-change`/`data-input`. */
    interface ClientActions {
        /** Meldet Aktionen an; im Markup als `p:<id>:<name>` aufrufen. */
        register(map: Record<string, (element: HTMLElement, event: Event) => void | Promise<void>>): void;
    }

    /** Aufrufe der eigenen Routen unter `/api/plugins/<id>`. */
    interface ClientApi {
        /** GET; liefert das JSON, bei Fehler eine Ablehnung mit der deutschen Meldung. */
        get(path: string, body?: undefined, options?: { password?: boolean }): Promise<any>;
        /** POST mit JSON; `password: true` fragt das Admin-Reset-Passwort ab. */
        post(path: string, body?: unknown, options?: { password?: boolean }): Promise<any>;
        /** PUT mit JSON. */
        put(path: string, body?: unknown, options?: { password?: boolean }): Promise<any>;
        /** DELETE. */
        delete(path: string, body?: unknown, options?: { password?: boolean }): Promise<any>;
    }

    /** Vorschau des Seiten-Designs (nur Admins). */
    interface ClientTheme {
        /**
         * Zeigt die Design-Vorschau.
         * @permission theme
         */
        showPreview(): void;
        /**
         * Beendet die Vorschau.
         * @permission theme
         */
        hidePreview(): void;
        /**
         * Lädt das veröffentlichte Design neu.
         * @permission theme
         */
        reload(): void;
        /**
         * Ob das Standard-Design aktiv ist.
         * @permission theme
         */
        isStandardMode(): boolean;
    }

    /** Hilfsfunktionen der Oberfläche. */
    interface ClientHelpers {
        /** Maskiert Text für HTML. */
        escapeHtml(text: string): string;
        /** Rendert Markdown sicher zu HTML. */
        renderMarkdownSafe(markdown: string): string;
        /** Kurzer Klartext einer Markdown-Vorschau (mit escapeHtml ausgeben). */
        markdownPreview(markdown: string, maxLength?: number): string;
        /** Zeigt eine Meldung. */
        showToast(message: string, type?: 'success' | 'danger' | 'warning' | 'info'): void;
        /** Fragt nach einer Bestätigung; true, wenn bestätigt. */
        showConfirmDialog(message: string, confirmLabel?: string, options?: { danger?: boolean }): Promise<boolean>;
        /** HTML eines Avatars. */
        avatar(options?: { url?: string; name?: string; size?: 'sm' | 'lg' | 'xl' }): string;
        /** HTML eines Leerzustands. */
        emptyState(options?: { icon?: string; title?: string; text?: string; action?: string }): string;
        /** Tag relativ zu heute („Heute“, „in 3 Tagen“). */
        relativeDay(date: Date, now: Date): string;
        /** Setzt `data-style-*`-Werte unterhalb von `root`. */
        applyStyleData(root: ParentNode): void;
        /** Zeigt ein Element. */
        showElement(element: HTMLElement): void;
        /** Zeigt oder versteckt ein Element. */
        toggleElement(element: HTMLElement, visible: boolean): void;
    }

    /** Das `ui` von `register(ui)` in client.js. */
    interface ClientUi {
        /** Angaben zum Plugin. */
        plugin: ClientPluginInfo;
        /** Der angemeldete Nutzer. */
        user: ClientUser;
        /** Meldet die eine Seite des Plugins an (`#p/<id>`). */
        addPage(page: PageOptions): void;
        /** Zahl am Tab; 0 blendet sie aus, über 99 zeigt „99+“. */
        setTabBadge(count: number): void;
        /** Aktionen. */
        actions: ClientActions;
        /** Eigene Routen aufrufen. */
        api: ClientApi;
        /** Design-Vorschau. */
        theme: ClientTheme;
        /**
         * Öffnet für Admins einen neuen Event-Entwurf im Editor; `ref` (1 bis 100 Zeichen) kommt als `event.origin.ref` zurück.
         * @permission events:draft
         */
        openEventEditor(options: { prefill?: Record<string, unknown>; ref: string }): void | Promise<void>;
        /** Wechselt zu `#p/<id>` oder `#p/<id>/<param>`. */
        navigate(param?: string): void;
        /** Hilfsfunktionen. */
        helpers: ClientHelpers;
    }
}

/** Das `ctx` von `register(ctx)` in server.js. */
type DemsServerContext = DemsPlugin.ServerContext;
/** Das `ui` von `register(ui)` in client.js. */
type DemsClientUi = DemsPlugin.ClientUi;
