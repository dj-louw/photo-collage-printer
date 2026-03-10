# Code Review Issues

Review date: March 10, 2026

---

## High Priority

### 1. [FIXED] PDF page size ignores user setting
**Location:** [app.js](../app.js#L1405-L1407)  
**Issue:** PDF is always created as A4 regardless of page size setting.  
**Reason:** Users who select "Letter" will get an A4-sized PDF with their Letter-sized content.  
**Fix:** Use `pages[0].size` to determine PDF orientation and size.

**Resolution:** Added logic to check `pages[0].size` dimensions and pass the appropriate format (`'letter'` or `'a4'`) to jsPDF constructor.

### 2. [NOT REPRODUCIBLE] Same file re-selection doesn't trigger import
**Location:** [app.js](../app.js#L1356)  
**Issue:** The file input won't fire `onchange` if the user selects the same file twice.  
**Reason:** The input's value isn't reset after import.  
**Fix:** Add `event.target.value = ''` at the end of `importPhoto()`.

**Resolution:** Could not reproduce in testing. Modern browsers appear to handle this correctly.

### 3. [FIXED] No error handling for image load failures
**Location:** [app.js](../app.js#L127-L193)  
**Issue:** `loadInitialSamplePhotos()` has no `img.onerror` handler.  
**Reason:** If sample photos fail to load, nothing happens and no feedback is given.  
**Fix:** Add `img.onerror` with console warning or fallback.

**Resolution:** Added `img.onerror` handler that displays an alert with the failed image path.

---

## Medium Priority

### 4. [FIXED] Inline styles instead of CSS classes
**Location:** Throughout `app.js`  
**Issue:** Nearly all styling is done via `element.style.x = 'y'` instead of CSS classes.  
**Reason:** Hard to maintain, override, or theme; bloats JavaScript; no hover/focus states possible in JS.  
**Fix:** Extract common patterns (icon buttons, modals, flyouts) to CSS classes.

**Resolution:** Created CSS classes in style.css:
- `.icon-btn`, `.icon-btn--lg`, `.icon-btn--md`, `.icon-btn--sm` for circular icon buttons
- `.icon-btn__icon`, `.icon-btn__icon--lg/md/sm` for centered icons
- `.flyout`, `.flyout__title`, `.flyout__row` for dropdown menus
- `.modal-overlay`, `.modal`, `.modal__title`, `.modal__content`, `.modal__row` for modal dialogs
Updated 15+ button/icon instances in app.js to use these classes instead of inline styles.

### 5. [FIXED] Large monolithic functions
**Location:** `renderCollagePage()` (~600 lines), `handlePointerMove()` (~200 lines)  
**Issue:** Functions are too long with deeply nested logic.  
**Reason:** Hard to read, test, and maintain.  
**Fix:** Extract into smaller helpers like `renderPhotoContainer()`, `renderCropHandles()`, `handleCropMaskResize()`.

**Resolution:** Extracted 6 helper functions from `renderCollagePage()`:
- `createPhotoMask(photo, pageIndex, idx)` - creates inner mask wrapper with image
- `createResizeHandles(pageIndex, idx, photo, inCropMode, container)` - creates resize/crop handles
- `createImageFrame(pageIndex, idx, photo, container)` - creates image frame for crop mode
- `createPhotoControls(pageIndex, idx, inCropMode, container)` - creates rotate/crop/delete buttons
- `createSizeInfo(photo, container)` - creates size readout display
- `createPageActions(pageWidthPx, scale)` - creates page add/delete buttons
Reduced `renderCollagePage()` from ~600 lines to ~140 lines.

### 6. [FIXED] Magic numbers scattered throughout
**Location:** Throughout `app.js`  
**Issue:** Hardcoded values like `3` (pxPerMm), `32` (handle size), `40` (button size), `-72` (offset).  
**Reason:** Changing these requires finding all occurrences.  
**Fix:** Define constants at the top: `const PX_PER_MM = 3; const HANDLE_SIZE = 32;`

**Resolution:** Added documented constants at the top of app.js:
- `PX_PER_MM = 3` - pixels per millimetre conversion (px)
- `MIN_PHOTO_SIZE_PX = 20` - minimum photo dimension (px)
- `HANDLE_SIZE_PX = 32` - resize handle size (px)
- `CONTROL_INSET_PX = 4` - control inset from edges (px)
- `BUTTON_SIZE_LG_PX = 40` - large button size (px)
- `ADD_IMAGE_BUTTON_OFFSET_PX = 72` - add-image button offset (px)
- `PAGE_SIZE_A4`, `PAGE_SIZE_LETTER` - standard page sizes (mm)
- `CROP_PRESET_*` - crop aspect ratio preset dimensions (mm)
Replaced all occurrences throughout the codebase.

### 7. No data persistence
**Location:** Global state variables  
**Issue:** All work is lost on page refresh.  
**Reason:** Users could accidentally lose their collage layout.  
**Fix:** Add localStorage save/restore or warn before unload.

### 8. [FIXED] Misleading function name
**Location:** [app.js](../app.js#L236) `renderPhotoControls()`  
**Issue:** Function renders print button, settings, GitHub link, help modal—not just "photo controls".  
**Reason:** Name doesn't match responsibility.  
**Fix:** Rename to `renderGlobalControls()` or split into separate functions.

**Resolution:** Rather than just renaming, moved all static UI elements to index.html:
- App header (title, subtitle, description) now in HTML
- Global control buttons (print, settings, GitHub, help) now in `#global-controls`
- Settings flyout now in `#settings-flyout` with `.hidden` toggle class
- Help modal now in `#help-overlay` with `.hidden` toggle class
Eliminated `renderPageControls()` and `renderPhotoControls()` entirely (~230 lines removed).
Added new functions: `initGlobalControls()`, `toggleSettings()`, `toggleHelp()`, `updateSettingsUI()`.

---

## Low Priority

### 9. Global state pollution
**Location:** [app.js](../app.js#L7-L51)  
**Issue:** All state is in global `let` variables.  
**Reason:** Makes testing difficult, risk of accidental mutation, hard to reason about.  
**Fix:** Encapsulate in a state object or use a simple state management pattern.

### 10. Inconsistent indentation
**Location:** [app.js](../app.js#L230) `   div.appendChild(description);`  
**Issue:** Extra leading space on this line.  
**Reason:** Code style inconsistency.  
**Fix:** Remove extra space.

### 11. Duplicated button creation pattern
**Location:** Throughout render functions  
**Issue:** The pattern for creating icon buttons (div + img + styles) is repeated 15+ times.  
**Reason:** DRY violation, harder to change button style globally.  
**Fix:** Create helper `createIconButton(iconSrc, alt, onClick, options)`.

### 12. CSS print rule has inconsistent formatting
**Location:** [style.css](../style.css#L266-L270)  
**Issue:** `.photo-container` block inside `@media print` has unusual indentation.  
**Reason:** Makes CSS harder to scan.  
**Fix:** Normalize indentation.

### 13. No accessibility features
**Location:** Throughout  
**Issue:** No ARIA labels, no keyboard navigation, no focus indicators for custom controls.  
**Reason:** App is unusable for keyboard-only or screen reader users.  
**Fix:** Add `role="button"`, `aria-label`, `tabindex`, keyboard event handlers.

### 14. External CDN dependencies without fallback
**Location:** [index.html](../index.html#L13-L14)  
**Issue:** jspdf and html2canvas loaded from CDN without local fallback.  
**Reason:** App won't work offline or if CDN is blocked.  
**Fix:** Bundle locally or add graceful fallback messaging.

---

## Summary

| Severity | Count |
|----------|-------|
| High     | 3     |
| Medium   | 5     |
| Low      | 6     |

The most impactful fixes would be:
1. Fix PDF page size (#1)
2. Fix file re-selection (#2)  
3. Extract inline styles to CSS (#4)
4. Add constants for magic numbers (#6)
