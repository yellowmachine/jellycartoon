# The houses a script runs on, from ~/.config/jellycartoon/casas (see scripts/casas.sh). Sourced:
# `select_houses "$@"` fills `selected` with "name ssh project" lines, or exits with why not.

config=${JELLYCARTOON_CASAS:-$HOME/.config/jellycartoon/casas}

select_houses() {
	# name, ssh destination and compose project of every house, one per line.
	local houses=() name dest project _
	if [[ -f $config ]]; then
		while read -r name dest project _; do
			[[ -z $name || $name == \#* ]] && continue
			houses+=("$name $dest ${project:-jellycartoon}")
		done <"$config"
	fi

	selected=()
	if [[ $# -eq 0 ]]; then
		selected=("${houses[@]}")
		[[ ${#selected[@]} -gt 0 ]] || {
			echo "No hay casas: créalas en $config (mira el principio de scripts/casas.sh)" >&2
			exit 1
		}
		return
	fi
	local arg house found
	for arg in "$@"; do
		if [[ $arg == *=* ]]; then
			selected+=("${arg%%=*} ${arg#*=} jellycartoon")
			continue
		fi
		found=
		for house in "${houses[@]}"; do
			[[ ${house%% *} == "$arg" ]] && found=$house
		done
		[[ -n $found ]] || {
			echo "No conozco la casa «$arg» (mira $config)" >&2
			exit 1
		}
		selected+=("$found")
	done
}
