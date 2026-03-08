# Photo Collage Printer – Technical Overview

This document explains how the current browser-only Photo Collage Printer is structured so future development (and future AI assistance) can ramp quickly and safely.

## Goals and Scope

- Prepare printable pages (A4/Letter) filled with photos.
- All logic runs in the browser (no backend).
- Users can:
  - Add/remove pages and change page size.
  - Import photos, which are auto-sized sensibly for the page.
  - Move, resize, and rotate photos.
  - Print via the browser’s print dialog.

For detailed functional requirements and roadmap, see:

- docs/requirements.md
- docs/IMPLEMENTATION_PLAN.md

This file focuses on **how** the app works today (architecture and behavior), not what might come later.

## Project Structure

- index.html
  - Minimal HTML shell; loads style.css and app.js and contains a single `<div id="app"></div>` root.
- style.css
  - Layout and basic styles for the app shell, page surface, photos, and resize handles.
- app.js
  - Main application logic (state, rendering, and all interactions).
- icons/file-rotate-right.svg
  - Rotation quick-action icon used for rotating the selected photo.
- docs/*.md
  - requirements.md: original feature requirements.
  - IMPLEMENTATION_PLAN.md: initial implementation plan.
  - TECHNICAL_OVERVIEW.md: this document.

## Core Architecture

### State Model

All application state is held in JavaScript variables in app.js:

- `pages: Page[]`
  - Array of page objects. Only one page is visible at a time.
  - `Page = { size: { width: number, height: number }, photos: Photo[] }`
  - `size` is in millimetres; rendering uses a scale factor of 3 (mm → px).
- `currentPage: number`
  - Zero-based index into `pages`, representing the active page.
- `Photo`
  - `src: string` – data URL for the image.
  - `x: number` – left position of the photo’s **unrotated bounding box** on the page (px).
  - `y: number` – top position of the photo’s unrotated bounding box on the page (px).
  - `width: number` – width of the unrotated bounding box (px).
  - `height: number` – height of the unrotated bounding box (px).
  - `rotation: number` – rotation in degrees, currently multiples of 90 (0, 90, 180, 270).
- Selection and interaction state
  - `selectedPhoto: number | null` – index of the currently selected photo on the current page.
  - Dragging
    - `dragIdx: number | null` – index of photo being dragged.
    - `dragOffset: { x: number, y: number } | null` – cursor offset from photo’s top-left at drag start.
    - `dragging: boolean` – whether a drag is in progress.
  - Resizing
    - `resizing: boolean` – whether a resize is in progress.
    - `resizeStart: { x: number, y: number } | null` – mouse position at resize start.
    - `resizePhotoIdx: number | null` – index of photo being resized.
    - `resizeOrig: { width, height, x, y, handle, dominant } | null`
      - Snapshot of the photo’s bounding box and which handle is active.
      - `handle` is one of `"nw" | "ne" | "se" | "sw" | "n" | "s" | "e" | "w"`.
      - `dominant` is `"width"` or `"height"` for corner resize (axis locking for aspect ratio).

### Rendering Strategy

Rendering is done in a simple, state-driven way:

- `render()` clears `#app` and calls:
  - `renderPageControls()` – page add/remove/size controls.
  - `renderPhotoControls()` – import and print controls.
  - `renderCollagePage()` – main page surface with all photos.
- The UI is **fully re-rendered** after each state change (dragging, resizing, rotating, importing, page change). There is no diffing/virtual DOM; the app is small enough that this is acceptable and greatly simplifies reasoning.

## DOM Structure for a Photo

Each photo on the active page is rendered as a nested DOM structure:

- Page container
  - `.collage-page` div sized to the active page:
    - `width = page.size.width * 3` px
    - `height = page.size.height * 3` px

- For each `photo` in `page.photos`:
  - `container` (unrotated bounding box)
    - Absolutely positioned at `(photo.x, photo.y)` on `.collage-page`.
    - `style.width = photo.width`, `style.height = photo.height`.
    - Holds:
      - `data-photo-index = idx` so event handlers can map DOM back to state.
      - `rotateWrapper` – rotated content.
      - Resize handles (if selected).
      - Rotate icon (if selected).
  - `rotateWrapper` (rotated interior)
    - Absolutely positioned at `left: 0; top: 0; width: 100%; height: 100%` within `container`.
    - `transform-origin: center center`.
    - `transform: rotate(photo.rotation || 0deg)`.
    - Contains the `<img>` element.
  - `img.photo`
    - Fills `rotateWrapper` with `width: 100%; height: 100%; object-fit: contain`.
    - Click selects the photo (`selectedPhoto = idx`).
  - Resize handles (if `selectedPhoto === idx`)
    - Eight circular handles added as absolutely positioned children of the **unrotated `container`**:
      - Corners: `nw`, `ne`, `sw`, `se`.
      - Edges: `n`, `s`, `w`, `e`.
    - Each handle has:
      - A specific position (e.g. `left: -8px; top: -8px` for `nw`).
      - A resize cursor (e.g. `nwse-resize`).
      - A `data-handle` attribute.
      - `onmousedown` bound to `startResize(e, idx, handleName)`.
  - Rotate icon (if `selectedPhoto === idx`)
    - An `img` element using `icons/file-rotate-right.svg`.
    - Absolutely positioned at `left: -24px; top: -24px` relative to the **unrotated `container`**.
    - Does **not** rotate with the image.
    - `onclick` calls `rotatePhoto(idx)`.

This arrangement ensures:

- The photo visually rotates, but:
  - The collision box and coordinates (x, y, width, height) remain axis-aligned.
  - Resize handles and the rotate icon stay at predictable, non-rotating positions around the bounding box.

## Interactions and Behavior

### Page Controls

Exposed globally on `window`:

- `addPage()`
  - Pushes a new page `{ size: A4, photos: [] }` onto `pages`.
  - Sets `currentPage` to the new page and calls `render()`.
- `removePage()`
  - Removes the current page if there is more than one.
  - Adjusts `currentPage` so it stays in range.
  - Clears `selectedPhoto` and re-renders.
- `changePageSize(size)`
  - Sets `pages[currentPage].size` to one of:
    - `A4: { width: 210, height: 297 }`
    - `Letter: { width: 216, height: 279 }`
  - Calls `render()`.

### Photo Import

- `importPhoto(event)`
  - Reads the first selected file as a data URL using `FileReader`.
  - Loads it into an `Image` to get `naturalWidth` and `naturalHeight`.
  - Computes:
    - `pageWidthPx = page.size.width * 3`.
    - `targetWidth = pageWidthPx * 0.5` (50% of page width).
    - `scale = targetWidth / naturalWidth`.
    - `width = targetWidth`.
    - `height = naturalHeight * scale`.
  - Adds a new `photo` at `(x: 10, y: 10)` with these dimensions and `rotation: 0`.
  - Selects the new photo and calls `render()`.

### Print

- `printCollage()` simply calls `window.print()` to open the browser’s print dialog.

### Selection

- `selectPhoto(idx)`
  - Sets `selectedPhoto = idx` and re-renders.
  - Only the selected photo shows resize handles and the rotate icon.

### Dragging (Moving Photos)

Handled via global mouse events:

- `document.addEventListener('mousedown', ...)`
  - Guard: only responds when `e.target` has class `photo` (clicking on the image, not a handle/icon).
  - Finds the containing `div` with `data-photo-index` via `closest('[data-photo-index]')`.
  - Sets `dragIdx` to that index and `dragging = true`.
  - `dragOffset` is the difference between the mouse position and the photo’s top-left corner `(photo.x, photo.y)` at drag start.
- `document.addEventListener('mousemove', ...)`
  - When `dragging && dragIdx !== null`:
    - Computes `newX`/`newY` by subtracting `dragOffset` from the current mouse position.
    - Clamps the position so the photo’s bounding box stays completely inside the page:
      - `0 ≤ x ≤ pageWidthPx - width`
      - `0 ≤ y ≤ pageHeightPx - height`.
    - Updates `photo.x`, `photo.y` and calls `render()`.
  - Dragging is handled before resize logic in this same handler.
- `document.addEventListener('mouseup', ...)`
  - Resets `dragging`, `dragIdx`, and `dragOffset` (also clears resize state, see next section).

### Resizing

Resizing updates the **axis-aligned bounding box** regardless of rotation. Handles live on the unrotated `container`, so directions remain intuitive.

- Start
  - Each handle’s `onmousedown` calls `startResize(e, idx, handleName)`.
  - `startResize`:
    - Stops propagation and `preventDefault()` to avoid starting a drag.
    - Sets `resizing = true`, `resizePhotoIdx = idx`, `resizeStart` to the current mouse position.
    - Captures `resizeOrig` as a snapshot of the photo’s width, height, x, y and the active `handle`.

- Move (while resizing)
  - In `document.addEventListener('mousemove', ...)`, if not dragging and `resizing` is true:
    - Computes `dx`, `dy` from `resizeStart`.
    - Defines a minimum size `minSize = 20`.
    - Computes new width/height and position according to the active handle.

  - Corners (`nw`, `ne`, `sw`, `se`):
    - `widthChange` and `heightChange` are derived from `dx`/`dy` such that dragging **outward** (away from the photo) yields positive changes.
    - On first movement, `resizeOrig.dominant` is set to `"width"` or `"height"` depending on which axis changed more.
    - Resize maintains the original aspect ratio:
      - If dominant is width → compute `targetWidth`, then `newHeight = targetWidth / aspect`.
      - If dominant is height → compute `targetHeight`, then `newWidth = targetHeight * aspect`.
    - For left/top corners, x and/or y are adjusted so the box appears to grow/shrink from that corner:
      - Left corners (`nw`, `sw`): `newX = resizeOrig.x + (resizeOrig.width - newWidth)`.
      - Top corners (`nw`, `ne`): `newY = resizeOrig.y + (resizeOrig.height - newHeight)`.

  - Edges (`n`, `s`, `w`, `e`):
    - Change width or height directly without preserving aspect ratio (stretching is allowed).
    - Examples:
      - East (`e`): `newWidth = resizeOrig.width + dx`.
      - West (`w`): `newWidth = resizeOrig.width - dx; newX` adjusted accordingly.
      - South (`s`): `newHeight = resizeOrig.height + dy`.
      - North (`n`): `newHeight = resizeOrig.height - dy; newY` adjusted accordingly.
    - Enforces `minSize` and updates x/y for top/left edges when clamping.

  - Page boundary clamping
    - After computing `newX`, `newY`, `newWidth`, `newHeight`, the code ensures the bounding box stays fully within the page rectangle, adjusting size and position as needed.
    - Width and height are finally clamped to at least `minSize`.

  - State update
    - Writes `photo.width`, `photo.height`, `photo.x`, and `photo.y`.
    - Calls `render()`.

- End
  - `document.addEventListener('mouseup', ...)` resets `resizing`, `resizePhotoIdx`, `resizeStart`, and `resizeOrig`.

### Rotation

- `rotatePhoto(idx)`
  - Increments `photo.rotation` by 90 degrees modulo 360.
  - Triggers a re-render.
  - Only the visual representation (via `transform: rotate(...)` on `rotateWrapper`) is rotated; the photo’s `x`, `y`, `width`, and `height` remain the axis-aligned bounding box used for drag and resize.
- The rotate icon is visually anchored to the unrotated bounding box and does not rotate.

## Key Design Decisions

- **Single source of truth in memory**
  - All UI is derived from `pages` and interaction flags; there is no hidden DOM state.
- **Full re-render on each change**
  - Simpler to reason about than incremental DOM updates given the small app size.
- **Axis-aligned bounding box model**
  - Rotation is purely visual; this keeps drag/resize math manageable.
- **Rotation wrapper**
  - Using an inner `rotateWrapper` allows the image (and potentially other future decorations) to rotate while handles and quick-action icons remain unrotated and predictable.
- **Data attributes for indexing**
  - `data-photo-index` on the container decouples event handling from DOM structure, making it safer to evolve the internals.

## Known Limitations / Future Work Hooks

- Resizing respects page bounds for the bounding box, not the rotated silhouette.
- All rotations are multiples of 90 degrees; arbitrary angle rotation is not supported.
- There is no persistence (reload loses state); adding localStorage or export/import could be a future enhancement.
- Overlapping photos are allowed, but there is no explicit z-index control beyond DOM order.

If you change the DOM structure or interaction model, update this document so future work (and future AI assistance) can rely on accurate, up-to-date technical context.
