#!/usr/bin/env bash
# Opens the Steam game whose appid JellyCartoon sends (jellycartoon-steam@.service gives it the
# socket as stdin), with Steam's own URLs: Big Picture first, so that leaving the game leaves Big
# Picture on the TV. xdg-open hands them to steam.desktop, which runs Steam in its own unit.
# Installed by scripts/pantalla.sh in ~/.local/bin.
set -u

read -r appid
# Only digits get into the URL; anything else is only logged, and ends well, so that no failed
# unit is left behind for each.
if [[ ! $appid =~ ^[0-9]+$ ]]; then
	echo "No es un appid de Steam: $appid"
	exit 0
fi

# Steam open: it takes both URLs at once, in order.
if pgrep -u "$UID" -x steam >/dev/null; then
	xdg-open steam://open/bigpicture
	exec xdg-open "steam://rungameid/$appid"
fi

# Steam closed: two URLs back to back start two Steams, and the game is lost. Big Picture alone,
# then the game once its interface is up, again until the game runs (its reaper, which Steam
# starts every game with), for two minutes at most.
xdg-open steam://open/bigpicture
for ((second = 0; second < 120; second += 2)); do
	sleep 2
	if pgrep -u "$UID" -f "SteamLaunch AppId=$appid( |$)" >/dev/null; then
		echo "Juego $appid abierto"
		exit 0
	fi
	pgrep -u "$UID" -x steamwebhelper >/dev/null || continue
	if [[ -z ${sent:-} ]] || ((second - sent >= 15)); then
		xdg-open "steam://rungameid/$appid"
		sent=$second
	fi
done
echo "Steam no abrió el juego $appid en dos minutos"
