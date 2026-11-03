#!/usr/bin/env bash
# Opens in RetroDECK the game JellyCartoon sends, as `<console folder>/<file>` of GAMES_DIR (or
# only RetroDECK, `retrodeck`) (jellycartoon-retrodeck@.service gives it the socket as stdin and
# GAMES_DIR). With RetroDECK's own command line: `-s` is the ES-DE system, which picks the
# emulator (RetroArch with its core, the one chosen in ES-DE for that system or game).
# Installed by scripts/pantalla.sh in ~/.local/bin.
set -u

app=net.retrodeck.retrodeck

read -r line
# RetroDECK alone (the RetroDECK card in /tv/juegos): its ES-DE, with every game it has.
if [[ $line == retrodeck ]]; then
	exec flatpak run "$app"
fi

# The console folders of games.ts, as ES-DE names their systems: the same, but FinalBurn Neo's
# arcade ROMs, which in ES-DE are `fbneo` (its `arcade` is MAME's).
declare -A systems=(
	[nes]=nes [snes]=snes [gb]=gb [gbc]=gbc [gba]=gba
	[mastersystem]=mastersystem [megadrive]=megadrive [arcade]=fbneo
)
folder=${line%%/*}
file=${line#*/}
# Only a known console and a plain file name of its folder; anything else is only logged, and
# ends well, so that no failed unit is left behind for each.
if [[ $line != */* || -z ${systems[$folder]:-} || -z $file || $file == */* || $file == .* ]]; then
	echo "No es un juego: $line"
	exit 0
fi
game=$GAMES_DIR/$folder/$file
if [[ ! -f $game ]]; then
	echo "No está el juego: $game"
	exit 0
fi
echo "Abriendo $game en RetroDECK (${systems[$folder]})"
exec flatpak run "$app" -s "${systems[$folder]}" "$game"
