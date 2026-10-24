-- A menu for the salon remote with only subtitles and audio, in Spanish: mpv's own
-- (`select/menu`) also lists key bindings, config files, history... and can't be trimmed.
-- Bound in input.conf as `script-binding mando/menu`; see "Mando del salón" in the README.
-- Built on mp.input, like mpv's select.lua: arrows move, Enter chooses, Esc closes.

local input = require "mp.input"

-- As the app names them (src/lib/languages.ts), so the phone and the TV say the same.
local LANGUAGES = {
    spa = "Español", es = "Español",
    eng = "English", en = "English",
    fre = "Français", fra = "Français", fr = "Français",
    ger = "Deutsch", deu = "Deutsch", de = "Deutsch",
    ita = "Italiano", it = "Italiano",
    por = "Português", pt = "Português",
    jpn = "日本語", ja = "日本語",
    cat = "Català", ca = "Català",
    -- Not languages: how TV channels tag their tracks (RTVE).
    qaa = "Versión original",
    ads = "Audiodescripción",
}

local CHANNELS = { [1] = "mono", [2] = "estéreo", [6] = "5.1", [8] = "7.1" }

-- e.g. `Español · 5.1` or `English · forzados`, like trackLabel in src/lib/salon.svelte.ts.
local function label(track)
    local lang = (track.lang or ""):lower():match("^[^-_]*")
    local name = LANGUAGES[lang]
    local parts = { name or (lang ~= "" and lang ~= "und" and lang) or "Desconocido" }
    if track.title and not (lang == "qaa" or lang == "ads") then
        parts[#parts + 1] = track.title
    end
    if track.type == "audio" and CHANNELS[track["demux-channel-count"]] then
        parts[#parts + 1] = CHANNELS[track["demux-channel-count"]]
    end
    if track.forced then
        parts[#parts + 1] = "forzados"
    end
    return table.concat(parts, " · ")
end

local function tracks_of(type)
    local tracks = {}
    for _, track in ipairs(mp.get_property_native("track-list", {})) do
        if track.type == type then
            tracks[#tracks + 1] = track
        end
    end
    return tracks
end

-- `property` is aid or sid; with `none`, a first item that turns it off.
local function choose(title, property, tracks, none)
    local items, values = {}, {}
    local current = mp.get_property_native(property)
    local default_item = 1
    if none then
        items[1] = (current == false and "● " or "○ ") .. none
        values[1] = "no"
    end
    for _, track in ipairs(tracks) do
        items[#items + 1] = (track.selected and "● " or "○ ") .. label(track)
        values[#values + 1] = track.id
        if track.selected then
            default_item = #items
        end
    end

    input.select({
        prompt = title .. ":",
        items = items,
        default_item = default_item,
        submit = function (i)
            mp.set_property(property, values[i])
            mp.osd_message(title .. ": " .. (values[i] == "no" and none or label(tracks[i - (none and 1 or 0)])))
        end,
    })
end

local function subtitles()
    choose("Subtítulos", "sid", tracks_of("sub"), "Sin subtítulos")
end

local function audio()
    choose("Audio", "aid", tracks_of("audio"))
end

mp.add_key_binding(nil, "menu", function ()
    -- «¿Sigues ahí?» (#77) on the screen, put there by the app: OK answers it instead.
    if mp.get_property_native("user-data/jellycartoon/asking") then
        mp.commandv("script-message", "jellycartoon-sigo")
        return
    end
    -- Someone is there: the app counts it (episodes in a row with nobody touching anything).
    mp.commandv("script-message", "jellycartoon-tecla")

    local entries = {}
    if #tracks_of("sub") > 0 then
        entries[#entries + 1] = { "Subtítulos", subtitles }
    end
    if #tracks_of("audio") > 1 then
        entries[#entries + 1] = { "Audio", audio }
    end

    if #entries == 0 then
        mp.osd_message("No hay subtítulos ni otros audios")
        return
    end
    -- Only one thing to choose: straight to it.
    if #entries == 1 then
        entries[1][2]()
        return
    end

    local items = {}
    for i, entry in ipairs(entries) do
        items[i] = entry[1]
    end
    input.select({
        prompt = "",
        items = items,
        -- Open while the next list replaces it, as select.lua's menu does.
        keep_open = true,
        submit = function (i)
            entries[i][2]()
        end,
    })
end)

-- The remote's power button (#159) puts the video away and brings the TV view in front
-- (deploy/kwin/jellycartoon-mando): out of sight it pauses, and goes on when it is in front again.
-- `focused`, as Wayland does not tell mpv it was minimized.
local paused_away = false

mp.observe_property("focused", "bool", function (_, focused)
    if focused == false and not mp.get_property_native("pause") and mp.get_property_native("vo-configured") then
        paused_away = true
        mp.set_property_native("pause", true)
    elseif focused and paused_away then
        paused_away = false
        mp.set_property_native("pause", false)
    end
end)

-- Playing out of sight (Play/Pause or a film sent from the TV view, with the video put away): KWin
-- is asked to bring it in front, by its shortcut without a key.
local function to_front()
    -- No window yet (from idle, the first file): it comes in front by itself.
    if mp.get_property_native("focused") ~= false or not mp.get_property_native("vo-configured") then
        return
    end
    mp.command_native_async({
        name = "subprocess",
        playback_only = false,
        args = { "busctl", "--user", "call", "org.kde.kglobalaccel", "/component/kwin",
                 "org.kde.kglobalaccel.Component", "invokeShortcut", "s", "JellyCartoon: el vídeo delante" },
    }, function () end)
end

mp.observe_property("pause", "bool", function (_, paused)
    if paused == false then
        paused_away = false
        to_front()
    end
end)
mp.register_event("file-loaded", to_front)
