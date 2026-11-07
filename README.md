# KDE Screen Grid Sync

KDE Screen Grid Sync is a KWin script that keeps virtual desktops aligned across multiple monitors and moves windows to the monitor currently showing each window's desktop.

## Compatibility

- **KDE only**
- **KWin 6.7+ / Plasma 6** (from the script header)
- Script version: **1.1.0**

## Required KDE setting

In KDE virtual desktop settings, enable:

- **"Switch desktops independently"**

This script depends on per-screen desktop switching.

## How it works

The script:

1. Detects monitor layout from monitor geometry (or uses manual coordinates if configured).
2. Maps monitors into row/column offsets.
3. Treats the virtual desktop grid as wrapping (row-major order).
4. When one monitor changes desktop, computes and updates the desktop shown on every other monitor using those offsets.
5. Moves windows to the monitor where their desktop is currently visible.

If the monitor layout or desktop configuration is invalid, syncing is disabled and KWin logs the reason.

## Example behavior

Assume:

- 3 monitors in one row: **Left**, **Center**, **Right**
- 9 desktops (3x3 grid)
- Monitor offsets are Left = -1, Center = 0, Right = +1 (relative to Center)

If the current visible desktops are `(Center, Right) = (8, 9)`, then:

- `(8, 9)` -> `(4, 5)`
- `(4, 5)` -> `(1, 2)`
- `(1, 2)` -> `(7, 8)`
- `(7, 8)` -> `(9, 1)`

This shows the wrap-around behavior of the desktop grid while preserving monitor offsets.

## Testing status

This script has been tested only in a **limited configuration**. Different monitor arrangements, desktop grid sizes, GPU/driver stacks, or window rules may behave differently.
