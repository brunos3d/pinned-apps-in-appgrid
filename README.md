# Pinned Apps in AppGrid


## Overview

Starting with GNOME 40, favorite applications are only displayed in the dock. This extension brings them back to the application grid, allowing you to keep your pinned/favorite apps visible in both places without interfering with your existing Dash-to-Dock layout.

https://github.com/user-attachments/assets/3b9a1c6c-a341-4e5f-accd-0d69b5a299c9

## Background

This project is a fork of the [favourites\-in\-appgrid](https://gitlab.gnome.org/harshadgavali/favourites-in-appgrid/) extension. It addresses the following issues related to rearranging favorite apps in both the GNOME Dock and the GNOME Application Grid:

- [Dash\-to\-Dock issue #2010](https://github.com/micheleg/dash-to-dock/issues/2010)
- [Dash\-to\-Dock issue #2122](https://github.com/micheleg/dash-to-dock/issues/2122)

## Features

- Pins your favorite applications in both the GNOME dock and application grid.
- Preserves your GNOME Dock setup and prevents unwanted rearrangements.

## Installation

### 1. Easy Way

Go and grab it from GNOME Extensions

https://extensions.gnome.org/extension/7660/keep-pinned-apps-in-appgrid/

### 2. DIY Locally

1.  Clone the repository:

```bash
git clone https://github.com/brunos3d/pinned-apps-in-appgrid.git
cd pinned-apps-in-appgrid
```

2.  Build the extension:

```bash
make
```

## License

This project is licensed under the GPL License. See the LICENSE file for details.
