all: pack update

pack:
	gnome-extensions pack --force

update:
	gnome-extensions install --force *.shell-extension.zip