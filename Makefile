HOST_CMD_PREFIX=$(if ${FLATPAK_ID},flatpak-spawn --host,)

all: pack update

pack:
	${HOST_CMD_PREFIX} gnome-extensions pack --force

update:
	${HOST_CMD_PREFIX} gnome-extensions install --force *.shell-extension.zip