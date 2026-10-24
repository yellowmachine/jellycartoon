// The salon remote's power button (#159), as Launch1 by deploy/70-mando-g20s.hwdb: shows the
// JellyCartoon TV view in front of whatever there is (Steam, a game, the desktop, a video in mpv)
// and, pressed again, puts it away and brings that back. See "Mando del salón" in the README.
// Installed by scripts/pantalla.sh in ~/.local/share/kwin/scripts.

// The TV view: an app window of Chromium (no address bar), titled like every page of the app.
function isTv(w) {
    return /chrom/i.test(w.resourceClass) &&
        (w.caption === "JellyCartoon" || w.caption.endsWith(" · JellyCartoon"));
}

// The salon's mpv (deploy/jellycartoon-mpv.service): it pauses itself when it is not in front
// and goes on when it is again (deploy/mpv/scripts/mando.lua).
function isVideo(w) {
    return w.resourceClass === "mpv";
}

// What was in front when the TV view came, to bring it back.
let behind = null;

function bringForward(w) {
    w.minimized = false;
    workspace.activeWindow = w;
}

function toggle() {
    const front = workspace.activeWindow;
    const tv = workspace.windowList().find(isTv);

    if (tv && front === tv) {
        tv.minimized = true;
        if (behind && workspace.windowList().includes(behind)) bringForward(behind);
        behind = null;
        return;
    }

    behind = front && front.normalWindow ? front : null;
    if (front && isVideo(front)) front.minimized = true;
    if (tv) bringForward(tv);
    // Not open: its launcher, through a user service (deploy/jellycartoon-tv.service).
    else callDBus("org.freedesktop.systemd1", "/org/freedesktop/systemd1",
        "org.freedesktop.systemd1.Manager", "StartUnit", "jellycartoon-tv.service", "replace");
}

registerShortcut("JellyCartoon: mostrar u ocultar",
    "JellyCartoon: mostrar u ocultar la vista TV (botón de encendido del mando)",
    "Launch (1)", toggle);

// The video in front again: asked by mpv when it starts playing out of sight, e.g. Play/Pause or
// a film sent from the TV view while the video was put away (no key; over D-Bus).
registerShortcut("JellyCartoon: el vídeo delante",
    "JellyCartoon: el vídeo del salón delante (lo pide mpv)", "", () => {
        const video = workspace.windowList().find(isVideo);
        if (!video) return;
        bringForward(video);
        behind = null;
    });
