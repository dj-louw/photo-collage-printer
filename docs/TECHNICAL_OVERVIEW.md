# Photo Collage Printer – Technical Overview

This document explains how the current browser-only Photo Collage Printer is structured so future development (and future AI assistance) can ramp quickly and safely.

## Goals and Scope

- Prepare multi-page documents (A4/Letter) filled with photos.
- All logic runs in the browser (no backend).
- Users can:
  - Add/remove pages and change page size.
  - Import photos, which are auto-sized sensibly for the page.
  - Move, resize, crop, and rotate photos non-destructively.
  - Scroll through all pages vertically, similar to a word processor.
  - Generate a multi-page PDF and/or print all pages via the browser’s print dialog.

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
  - Array of page objects.
  - `Page = { size: { width: number, height: number }, photos: Photo[] }`
  - `size` is in millimetres; rendering uses a scale factor of 3 (mm → px).
  - All pages are rendered; `currentPage` simply marks the *active* page for controls and new imports.
- `currentPage: number`
  - Zero-based index into `pages`, representing the active page for:
    - The page-size dropdown.
    - Add/remove operations.
    - New photo imports and most interactions.
- `Photo`
  - Layout (crop mask / bounding box on the page):
    - `x: number` – left position of the visible crop box on the page (px).
    - `y: number` – top position of the visible crop box on the page (px).
    - `width: number` – width of the crop box / photo container (px).
    - `height: number` – height of the crop box / photo container (px).
  - Image content (underlying bitmap inside the mask):
    - `src: string` – data URL for the *current* bitmap for this photo (updated when rotating).
    - `imageWidth: number` – drawn width of the underlying image in pixels.
    - `imageHeight: number` – drawn height of the underlying image in pixels.
    - `imageOffsetX: number` – left offset of the image relative to the crop box (usually ≤ 0).
    - `imageOffsetY: number` – top offset of the image relative to the crop box (usually ≤ 0).
  - `rotation: number`
    - Logical rotation in 90° steps; currently not used for CSS transforms but kept for potential future use.
  - `cropMask: string | null`
    - Identifier of the active crop mask overlay, or `null` for no mask.
    - Current values: `'border-3mm'` (3mm white border all sides), `'polaroid'` (3mm top/left/right, 15mm bottom).
    - Mask definitions live in the `CROP_MASKS` registry constant at the top of `app.js`.
- Selection and interaction state
  - Selection
    - `selectedPhoto: number | null` – index of the currently selected photo *on the active page*.
  - Cropping
    - `cropMode: boolean` – whether crop-edit mode is active.
    - `cropPhotoIdx: number | null` – index of the photo (on the active page) being cropped.
    - `cropDragImage: boolean` – when true, dragging the image moves it under a fixed mask.
    - `cropImageDragStart: { x: number, y: number } | null` – mouse position at image-drag start.
    - `cropImageOrigOffset: { x: number, y: number } | null` – original `imageOffsetX/Y` at drag start.
  - Dragging (moving the crop box / container)
    - `dragIdx: number | null` – index of photo being dragged on the active page.
    - `dragOffset: { x: number, y: number } | null` – cursor offset from photo’s top-left at drag start.
    - `dragging: boolean` – whether a drag is in progress.
  - Resizing
    - `resizing: boolean` – whether a resize is in progress.
    - `resizeStart: { x: number, y: number } | null` – mouse position at resize start.
    - `resizePhotoIdx: number | null` – index of photo being resized on the active page.
    - `resizeOrig`
      - Snapshot of the photo’s geometry at resize start, plus which handle is active.
      - Shape:
        - `kind: 'box' | 'image'` – whether we are resizing the crop box or the underlying image.
        - `width, height, x, y` – original crop box.
        - `handle` – one of `'se' | 'n' | 's' | 'e' | 'w'` depending on the handle used.
        - `dominant` – `'width'` or `'height'` for some resize flows (axis locking).
        - `imageWidth, imageHeight, imageOffsetX, imageOffsetY` – original image geometry.

### Rendering Strategy

Rendering is done in a simple, state-driven way:

- `render()` clears `#app` and calls:
  - `renderPageControls()` – page add/remove/size controls for the active page.
  - `renderPhotoControls()` – import and print controls.
  - `renderCollagePage()` – renders **all pages**, stacked vertically.
- The UI is **fully re-rendered** after each state change (dragging, resizing, rotating, importing, page change, crop toggling). There is no diffing/virtual DOM; the app is small enough that this is acceptable and greatly simplifies reasoning.

## DOM Structure for a Photo

Each page and photo is rendered as a nested DOM structure.

- Page containers
  - One `.collage-page` div per entry in `pages`:
    - `width = page.size.width * 3` px
    - `height = page.size.height * 3` px
    - Stacked vertically with margins between pages.
    - `data-page-index = pageIndex` to map DOM back to state.

- For each `photo` in `page.photos`:
  - `container` (crop box / bounding box)
    - `.photo-container` div, absolutely positioned at `(photo.x, photo.y)` on its `.collage-page`.
    - `style.width = photo.width`, `style.height = photo.height`.
    - Holds:
      - `data-page-index = pageIndex` and `data-photo-index = idx` so event handlers can map DOM back to state.
      - Selection classes:
        - `selected` – when this photo is selected on the active page.
        - `cropping-active` – when this photo is in crop mode on the active page.
      - The crop mask wrapper.
      - Any visible handles and quick-action buttons.
  - Crop mask wrapper
    - `.photo-mask` div inside `container`.
    - Positioned to fill the container (`inset: 0`) with `overflow: hidden`.
    - Defines the *visible* region (crop box); anything outside is clipped.
    - If the photo has a `cropMask` set, four `.crop-mask-strip` divs are appended after the `<img>`, rendering opaque white border strips at the defined mm insets. These sit above the image (`z-index: 1`) and are pointer-transparent.
  - `img.photo`
    - Absolutely positioned inside `.photo-mask`:
      - `left = imageOffsetX`, `top = imageOffsetY`.
      - `width = imageWidth`, `height = imageHeight`.
    - The image may extend beyond the mask; the mask provides clipping.
    - `onclick` selects the photo and makes its page the active page.
  - Handles and controls (only for the selected photo on the active page)
    - Normal mode (not in crop mode):
      - A single circular resize handle in the lower-right corner of the crop box:
        - `.resize-handle.image-resize-handle` at `right: -32px; bottom: -32px`.
        - Contains a diagonal arrow icon (`icons/arrow-top-left-bottom-right.svg`).
        - `onmousedown` → `startResize(e, idx, 'se')` for that page.
    - Crop mode:
      - Edge crop handles for the mask itself (box resize):
        - Square handles on left (`w`), right (`e`), and bottom (`s`) edges.
        - Each is a `.resize-handle.image-resize-handle` div with a directional arrow icon:
          - Right edge (`e`) shows `icons/arrow-expand-left.svg` (crop inward from right).
          - Left edge (`w`) shows `icons/arrow-expand-right.svg`.
          - Bottom edge (`s`) shows `icons/arrow-expand-up.svg`.
        - `onmousedown` → `startResize(e, idx, handleName)` with `handleName ∈ { 'e', 'w', 's' }`.
      - Image zoom handle (for resizing the underlying image while the mask stays fixed):
        - `.image-frame` div outlines the full drawn image using `imageWidth/Height` and offsets.
        - A circular `.resize-handle.image-resize-handle` at the frame’s bottom-right (`'se'`) acts as a zoom control.
        - Contains the same diagonal arrow icon as the normal resize handle.
        - `onmousedown` → `startImageResize(e, idx, 'se')`.
    - Rotate and crop toggle buttons:
      - Two circular buttons styled like handles, positioned just above the left edge of the crop box:
        - Rotate button at `left: 0; top: -40px`, with `icons/file-rotate-right.svg` centered inside.
        - Crop-mode toggle button at `left: 40px; top: -40px`, with `icons/crop.svg` centered inside.
      - The crop toggle has an extra `crop-toggle` class and a thicker blue border when crop mode is active for that photo.
      - Clicking these buttons:
        - Rotate → rotates the image 90° clockwise while preserving crop and zoom.
        - Crop toggle → enters/exits crop mode for that photo.
    - Crop mask gear button and size readout (top-right of selected photo):
      - A gear icon button at `right: 4px; top: 4px` opens the crop mask selection modal.
      - The size info readout (aspect ratio + mm dimensions) is positioned below the gear button.
    - Crop mask selection modal:
      - Dynamically created overlay with radio-button rows for each mask option (None, Simple border, Polaroid).
      - Selecting a mask sets `photo.cropMask` and re-renders; minimum size constraints are enforced.

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
  - The dropdown reflects the current page’s size by inspecting `pages[currentPage].size` on each render.

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
  - Adds a new `photo` at `(x: 10, y: 10)` on the active page with these dimensions and `rotation: 0`.
  - Initializes the non-destructive crop fields so that the image exactly fills the crop box:
    - `imageWidth = width`, `imageHeight = height`, `imageOffsetX = 0`, `imageOffsetY = 0`.
  - Selects the new photo and calls `render()`.

### Print / PDF Export

- `printCollage()`
  - Preferred path: generates a multi-page PDF using `html2canvas` and `jsPDF`.
  - Implementation:
    - Collects all `.collage-page` elements in DOM order.
    - Temporarily adds a `body.printing-pdf` class so that selection outlines and handles are hidden.
    - For each page element:
      - Renders it to a high-resolution canvas via `html2canvas(pageEl, { scale: 2 })`.
      - Adds the resulting image to a `jsPDF` document, one PDF page per collage page.
    - Saves the PDF as `collage.pdf`.
    - Removes the `printing-pdf` class.
- Direct browser printing
  - The user can still use the browser’s `Print` dialog.
  - CSS `@media print` rules hide all UI chrome and handles, show only `.collage-page` elements, and insert page breaks so each collage page prints on its own sheet.

### Selection

- `selectPhoto(pageIndex, idx)`
  - Sets `currentPage = pageIndex` and `selectedPhoto = idx`.
  - Clears crop mode (`cropMode = false`, `cropPhotoIdx = null`) to keep the interaction model simple when switching photos/pages.
  - Re-renders.
  - Only the selected photo on the active page shows resize/crop handles and quick-action buttons.
- Clicking on empty space on a page
  - A click handler on each `.collage-page` checks whether the click hit any `.photo-container`.
  - If not, it:
    - Sets `currentPage` to that page.
    - Clears `selectedPhoto` and crop mode.
    - Re-renders.

### Dragging (Moving Photos and Image Within Crop)

Handled via global mouse events:

- `document.addEventListener('mousedown', ...)`
  - Guard: only responds when `e.target` has class `photo` (clicking on the image, not a handle/icon).
  - Finds the containing `div` with `data-photo-index` and `data-page-index` using `closest('[data-photo-index]')`.
  - Sets `currentPage` to the photo’s page so subsequent logic uses the correct dimensions.
  - If crop mode is active for this photo (`cropMode && cropPhotoIdx === idx`):
    - Starts an *image drag* under a fixed mask:
      - `cropDragImage = true`.
      - `cropImageDragStart` captures the mouse position.
      - `cropImageOrigOffset` captures the current `imageOffsetX/Y`.
  - Otherwise:
    - Starts a normal container drag:
      - `dragIdx = idx`, `dragging = true`.
      - `dragOffset` is the difference between the mouse position and `(photo.x, photo.y)`.

- `document.addEventListener('mousemove', ...)`
  - When dragging the **image under a fixed crop mask** (`cropMode && cropDragImage`):
    - Computes `dx/dy` from `cropImageDragStart`.
    - Applies them to `imageOffsetX/Y`.
    - Clamps offsets so the image always fully covers the crop box (no empty gaps inside the mask).
    - Calls `render()`.
  - When dragging the **container** (`dragging && dragIdx !== null`):
    - Computes `newX/newY` by subtracting `dragOffset` from the current mouse position.
    - Clamps so the crop box stays fully inside the page:
      - `0 ≤ x ≤ pageWidthPx - width`
      - `0 ≤ y ≤ pageHeightPx - height`.
    - Updates `photo.x`, `photo.y` and calls `render()`.
  - Dragging is handled before resize logic in this same handler.

- `document.addEventListener('mouseup', ...)`
  - Resets all drag and resize flags, including crop-drag flags.

### Resizing

Resizing covers three cases: normal box resize, crop-mask resize, and image zoom while cropping.

- Start
  - Box resize: each mask/box handle’s `onmousedown` calls `startResize(e, idx, handleName)`.
    - Sets `resizing = true`, `resizePhotoIdx = idx`, `resizeStart` to the mouse position.
    - Captures `resizeOrig` with `kind: 'box'` and both box and image geometry.
  - Image zoom resize: the image-frame handle calls `startImageResize(e, idx, 'se')`.
    - Same as above, but with `kind: 'image'`.

- Move (while resizing)
  - In `document.addEventListener('mousemove', ...)`, if not dragging and `resizing` is true:
    - Computes `dx`, `dy` from `resizeStart`.
    - Uses `minSize = 20` for crop box size.

  - Image zoom in crop mode (`cropMode && kind === 'image'`):
    - Computes a uniform `scale` factor based on drag direction and a dominant axis.
    - Updates `imageWidth/Height` by this scale.
    - Adjusts `imageOffsetX/Y` so that the corner opposite the dragged handle stays anchored.
    - Clamps `imageOffsetX/Y` so the image still fully covers the mask (no empty areas inside the crop box).
    - Calls `render()`.

  - Crop-mask resize in crop mode (`cropMode && kind === 'box'`):
    - Uses edge handles (`'e'`, `'w'`, `'s'`) to move a single edge of the crop box:
      - East (`e`): `newWidth = resizeOrig.width + dx`.
      - West (`w`): `newWidth = resizeOrig.width - dx; newX` adjusted accordingly.
      - South (`s`): `newHeight = resizeOrig.height + dy`.
    - Enforces `minSize` and updates x/y for left edges when clamping.
    - Clamps the mask to stay within the page bounds.
    - Ensures the mask never extends beyond the drawn image by limiting width/height to the available image area (`imageWidth/Height` and offsets).
    - Updates `photo.width`, `photo.height`, `photo.x`, `photo.y` and re-renders.

  - Normal resize (not in crop mode):
    - Uses a single corner handle (`'se'`) on the crop box.
    - Resizes the box and scales the underlying image and any existing crop proportionally so the visual result matches the box.
    - Maintains reasonable aspect handling via `resizeOrig.dominant` and clamps to page bounds.

- End
  - `document.addEventListener('mouseup', ...)` resets `resizing`, `resizePhotoIdx`, `resizeStart`, and `resizeOrig`.

### Rotation

- `rotatePhoto(idx)`
  - Rotates the underlying bitmap by 90° clockwise using a `<canvas>`, instead of relying on CSS transforms.
  - Steps:
    - Loads the current `photo.src` into an `Image`.
    - Describes the current crop as normalized fractions relative to `imageWidth/Height` (crop center and size).
    - Creates a canvas with swapped dimensions (`width = img.height`, `height = img.width`).
    - Draws the image rotated 90° around the canvas center.
    - Computes a new `src` data URL from the canvas.
    - Computes new `imageWidth/Height` such that the *zoom level* remains the same.
    - Applies the rotated crop fractions so that the same relative region is visible after rotation.
    - Updates the crop box (`photo.width/height`) to match the rotated crop extents.
    - Recenters the crop box around its previous center while clamping it to page bounds.
  - Writes back:
    - `photo.src`, `photo.width`, `photo.height`, `photo.x`, `photo.y`.
    - `photo.imageWidth`, `photo.imageHeight`, `photo.imageOffsetX`, `photo.imageOffsetY`.
- The rotate button is visually anchored to the crop box (unrotated frame) and does not rotate.

## Key Design Decisions

- **Single source of truth in memory**
  - All UI is derived from `pages` and interaction flags; there is no hidden DOM state.
- **Full re-render on each change**
  - Simpler to reason about than incremental DOM updates given the small app size.
-- **Axis-aligned bounding box model**
  - All layout and interaction math is done in terms of the axis-aligned crop box; rotation is applied to the bitmap and then projected back into this model.
-- **Non-destructive cropping**
  - The crop is represented as a mask (`width/height/x/y`) plus image offsets and size; the original bitmap is never permanently cut down.
-- **Bitmap rotation that preserves crop**
  - Rotating via canvas plus normalized crop fractions keeps the visible region and zoom level stable across 90° rotations.
- **Data attributes for indexing**
  - `data-photo-index` on the container decouples event handling from DOM structure, making it safer to evolve the internals.

## Known Limitations / Future Work Hooks

- Resizing respects page bounds for the bounding box, not the rotated silhouette.
- All rotations are multiples of 90 degrees; arbitrary angle rotation is not supported.
- There is no persistence (reload loses state); adding localStorage or export/import could be a future enhancement.
- Overlapping photos are allowed, but there is no explicit z-index control beyond DOM order.
- Very large numbers of pages will increase PDF generation time, since each page is rasterized via html2canvas.

If you change the DOM structure or interaction model, update this document so future work (and future AI assistance) can rely on accurate, up-to-date technical context.
