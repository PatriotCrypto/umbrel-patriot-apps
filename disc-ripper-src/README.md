# Disc Ripper for Umbrel

Plug a USB DVD drive into your Umbrel, put a disc in, and walk away. Disc Ripper notices the disc, works out what it is, rips it with [MakeMKV](https://www.makemkv.com) at full quality, saves it where Jellyfin expects it, and ejects the disc when it is done.

## How it works

1. Insert a disc. The app reads its label and its list of titles.
2. It decides whether the disc is a **movie** (one long title) or a **TV season** (several episodes of similar length, ignoring "play all" and bonus clips).
3. It looks up the real name: movies through IMDb's public search, TV shows and episode titles through [TVmaze](https://www.tvmaze.com).
4. If it is sure, it rips right away. If not, the status page asks you to confirm the title (or switch on automatic mode in settings to always use its best guess). If anything goes wrong, it keeps the disc in the drive and asks you what to do instead of cancelling or ejecting by itself.
5. Files are saved and the disc is ejected:
   - Movies: `Movies / Name (Year) / Name (Year).mkv`
   - TV: `TV Shows / Show (Year) / Season 01 / Show (Year) - S01E01 - Episode Title.mkv`, and numbering continues from one disc to the next (disc 2 starts where disc 1 stopped).

## Setup

1. Install the app from the community store, then open its settings in Umbrel, go to **Storage**, and under **Access to your folders** give it your Media folder with read and write access.
2. Open Disc Ripper, open **Settings**, and press **Get the free beta key**. MakeMKV is free while in beta; you can also buy a permanent key and paste it there. With "fetch a fresh key automatically" on, the app renews the beta key when it expires.
3. Plug in the drive. If it is not noticed, press **Check drive** in settings.

Slim USB DVD drives draw more power than some ports give. If the drive clicks or disappears, use a different USB port or a powered hub.

## Notes

- **Look:** the modern design is the default. Settings has a Look option to switch to the classic Windows 98 style. The animated drive follows your real drive's tray when the drive reports it; some USB drives do not, and then the app works it out from the disc being present and from its own Eject button.
- The 3D drive uses [three.js](https://threejs.org) (MIT license, bundled in the app).
- Rip only discs you own, for your own use. Copying discs may be restricted where you live.
- DVDs are supported first. Blu-ray discs may also work with MakeMKV but are untested here.
- MakeMKV is built from its published source inside the image and checked against the checksums on makemkv.com. MakeMKV is proprietary shareware; see its license on makemkv.com.
- The app only contacts IMDb's suggestion service, TVmaze, and (to fetch the free beta key) the MakeMKV forum.
- Movie titles come from IMDb's public suggestion service and TV data from TVmaze (CC BY-SA). Not affiliated with MakeMKV, IMDb or TVmaze.

## Safety

The container drops all privileges except the few it needs, has a read-only filesystem, and can only open optical drives and SCSI generic devices.

MIT licensed (the app code).
