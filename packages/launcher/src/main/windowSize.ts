export interface Size {
  width: number
  height: number
}

/** The launcher window as designed. */
export const WINDOW_TARGET: Readonly<Size> = { width: 1200, height: 700 }

/**
 * The size the window is created at: the target, shrunk on either axis to
 * the primary display's work area (the screen minus taskbar and docked
 * toolbars), so a 1366 by 768 laptop shows the whole launcher. Pure; the
 * caller reads `screen.getPrimaryDisplay().workAreaSize`, which is whole
 * device-independent pixels already.
 */
export function clampToWorkArea(target: Size, workArea: Size): Size {
  return {
    width: Math.min(target.width, workArea.width),
    height: Math.min(target.height, workArea.height),
  }
}
