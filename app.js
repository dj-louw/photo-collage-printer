// Photo Collage Printer - app.js
// Main entry point for the web-app

const app = document.getElementById('collage-pages');

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

// Conversion factor: pixels per millimetre. The collage is
// rendered at 3px/mm (roughly 76 dpi) for on-screen display,
// matching the PDF export resolution.
const PX_PER_MM = 3;

// Minimum width/height a photo box can be resized to (px).
// Prevents collapsing to zero or negative dimensions.
const MIN_PHOTO_SIZE_PX = 20;

// Size of drag handles for resizing photos and crop masks (px).
const HANDLE_SIZE_PX = 32;

// Inset from photo edge for positioning controls and handles (px).
const CONTROL_INSET_PX = 4;

// Standard large button size used in the UI, e.g. page actions (px).
const BUTTON_SIZE_LG_PX = 40;

// Horizontal offset for the add-image button from the page edge (px).
// Calculated as BUTTON_SIZE_LG_PX + HANDLE_SIZE_PX + gap.
const ADD_IMAGE_BUTTON_OFFSET_PX = 72;

// Standard page sizes in millimetres.
const PAGE_SIZE_A4 = { width: 210, height: 297 };
const PAGE_SIZE_LETTER = { width: 216, height: 279 };

// Crop aspect ratio preset dimensions (mm).
// 4:3 landscape: 150mm × 100mm (common photo print size).
const CROP_PRESET_4_3_WIDTH_MM = 150;
const CROP_PRESET_4_3_HEIGHT_MM = 100;
// 3:4 portrait: 100mm × 150mm.
const CROP_PRESET_3_4_WIDTH_MM = 100;
const CROP_PRESET_3_4_HEIGHT_MM = 150;

// Scale factor for html2canvas when generating PDFs.
// 4 yields ~300 dpi (PX_PER_MM × 4 = 12 px/mm ≈ 305 dpi),
// suitable for high-quality photo printing.
const PDF_EXPORT_SCALE = 4;

// Crop mask definitions. Each mask specifies insets (in mm)
// that define opaque border strips overlaid on the image.
const CROP_MASKS = {
  'border-3mm': {
    label: 'Simple border (3 mm)',
    top: 3, right: 3, bottom: 3, left: 3,
    color: '#ffffff'
  },
  'polaroid': {
    label: 'Polaroid',
    top: 3, right: 3, bottom: 15, left: 3,
    color: '#ffffff'
  }
};

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

/**
 * Application state object. Separates persistable document data
 * from transient interaction state.
 * 
 * - `document`: Serializable project data (pages, photos, positions)
 * - `selection`: Currently selected photo
 * - `drag`: Active drag operation state
 * - `resize`: Active resize operation state
 * - `pointer`: Pointer capture for touch/pen tracking
 * - `crop`: Crop mode state
 * - `ui`: UI-related state (scale factors, etc.)
 */
const state = {
  // === PERSISTABLE (can be saved/exported) ===
  document: {
    pages: [{
      size: { ...PAGE_SIZE_A4 }, // A4 in mm
      photos: []
    }],
    currentPage: 0,
  },

  // === TRANSIENT (not persisted) ===
  
  // Selection state
  selection: {
    photoIdx: null,
  },

  // Drag state (moving the photo container on the page)
  drag: {
    active: false,
    photoIdx: null,
    startPointer: null,   // initial pointer position {x, y}
    startPosition: null,  // initial photo position {x, y}
  },

  // Resize state (handles on the bounding box / crop mask)
  resize: {
    active: false,
    photoIdx: null,
    start: null,
    orig: null,
    handleElement: null,
  },

  // Pointer capture state for reliable touch/pen tracking
  pointer: {
    activeId: null,
    capturedElement: null,
  },

  // Crop state
  crop: {
    active: false,        // whether crop mode is active
    photoIdx: null,       // which photo is in crop mode
    // Optional aspect-ratio lock for the crop mask.
    // Values: '4:3' | '3:4' | '1:1' | null
    aspectMode: null,
    // When dragging the image (not the mask) in crop mode
    draggingImage: false,
    imageDragStart: null,
    imageOrigOffset: null,
  },

  // UI state
  ui: {
    // Responsive scaling factor applied to collage pages
    pageScale: 1,
  },
};

// Calculate the scale factor for the collage page based on
// available viewport width. Leaves space for side controls
// (80px left for add-image button, 40px right for handles).
function calculatePageScale(pageWidthPx) {
  // On desktop, use full size (scale 1)
  const viewportWidth = window.innerWidth;
  // Threshold below which we start scaling
  const scaleThreshold = 800;
  if (viewportWidth >= scaleThreshold) {
    return 1;
  }
  // Reserve space for side controls and some padding
  const sideMargin = 100; // 80px left + 20px right buffer
  const availableWidth = viewportWidth - sideMargin;
  const scale = Math.min(1, availableWidth / pageWidthPx);
  // Don't scale below 0.3 to keep things usable
  return Math.max(0.3, scale);
}

// Apply counter-scaling to control elements (handles, buttons)
// inside a scaled page so they remain at their original visual
// size. Takes the element and an origin string for transform-origin.
// Preserves any existing transform on the element.
function applyCounterScale(el, origin = 'center center') {
  if (state.ui.pageScale >= 1) return;
  const counterScale = 1 / state.ui.pageScale;
  const existingTransform = el.style.transform || '';
  if (existingTransform) {
    el.style.transform = `${existingTransform} scale(${counterScale})`;
  } else {
    el.style.transform = `scale(${counterScale})`;
  }
  el.style.transformOrigin = origin;
}

/**
 * Creates an icon button element with standard styling.
 * Consolidates the repeated pattern of div + img + classes.
 * 
 * @param {Object} options
 * @param {string} options.iconSrc - Path to the icon image
 * @param {string} options.alt - Alt text for the icon
 * @param {function} options.onClick - Click handler
 * @param {string} [options.size='md'] - Button size: 'sm', 'md', or 'lg'
 * @param {string} [options.extraClasses=''] - Additional CSS classes
 * @param {Object} [options.position] - Position styles {left, right, top, bottom, transform}
 * @param {boolean} [options.ignoreCanvas=true] - Set data-html2canvas-ignore
 * @param {string|boolean} [options.counterScale=false] - Transform origin for counter scale
 * @returns {HTMLElement} The button element
 */
function createIconButton(options) {
  const {
    iconSrc,
    alt,
    onClick,
    size = 'md',
    extraClasses = '',
    position = {},
    ignoreCanvas = true,
    counterScale = false,
  } = options;

  const btn = document.createElement('div');
  btn.className = `resize-handle image-resize-handle icon-btn icon-btn--${size}${extraClasses ? ' ' + extraClasses : ''}`;
  
  if (ignoreCanvas) {
    btn.setAttribute('data-html2canvas-ignore', 'true');
  }
  
  // Apply position styles
  if (position.left !== undefined) btn.style.left = position.left;
  if (position.right !== undefined) btn.style.right = position.right;
  if (position.top !== undefined) btn.style.top = position.top;
  if (position.bottom !== undefined) btn.style.bottom = position.bottom;
  if (position.transform !== undefined) btn.style.transform = position.transform;
  
  btn.onclick = onClick;

  const icon = document.createElement('img');
  icon.src = iconSrc;
  icon.alt = alt;
  icon.className = `icon-btn__icon icon-btn__icon--${size}`;
  btn.appendChild(icon);

  if (counterScale) {
    applyCounterScale(btn, counterScale);
  }

  return btn;
}

// Declarative layout for the built-in sample photos. Edit
// xMm / yMm / widthMm / heightMm / rotationTurns here to
// change their initial position, size and rotation.
const SAMPLE_PHOTO_LAYOUT = [
  {
    id: 'family-photo-1',
    src: 'sample-photos/family-photo-1.jpg',
    xMm: 10,
    yMm: 10,
    widthMm: 95,
    heightMm: 95,
    rotationTurns: 0
  },
  {
    id: 'family-photo-2',
    src: 'sample-photos/family-photo-2.jpg',
    xMm: 10 ,
    yMm: 120,
    widthMm: 190,
    heightMm: null,
    rotationTurns: 0
  },
  {
    id: 'family-photo-3',
    src: 'sample-photos/family-photo-3.jpg',
    xMm: 110 ,
    yMm: 10,
    widthMm: 95,
    heightMm: 95,
    rotationTurns: 0
  }
];

// Load the declarative sample layout onto the first page
// when the app starts, so new users see an example.
function loadInitialSamplePhotos() {
  const page = state.document.pages[0];
  if (!page || page.photos.length > 0) return;

  SAMPLE_PHOTO_LAYOUT.forEach(config => {
    const img = new Image();
    img.onload = function() {
      const naturalW = img.naturalWidth || img.width || 1;
      const naturalH = img.naturalHeight || img.height || 1;

      let widthPx;
      let heightPx;
      if (config.widthMm) {
        widthPx = config.widthMm * PX_PER_MM;
        heightPx = widthPx * (naturalH / naturalW);
      } else if (config.heightMm) {
        heightPx = config.heightMm * PX_PER_MM;
        widthPx = heightPx * (naturalW / naturalH);
      } else {
        // Fallback: use 45% of page width.
        const pageWidthPx = page.size.width * PX_PER_MM;
        widthPx = pageWidthPx * 0.45;
        const scale = widthPx / naturalW;
        heightPx = naturalH * scale;
      }

      const xPx = (config.xMm != null ? config.xMm * PX_PER_MM : 10);
      const yPx = (config.yMm != null ? config.yMm * PX_PER_MM : 10);

      const photo = {
        src: config.src,
        x: xPx,
        y: yPx,
        width: widthPx,
        height: heightPx,
        rotation: 0,
        imageWidth: widthPx,
        imageHeight: heightPx,
        imageOffsetX: 0,
        imageOffsetY: 0,
        cropMask: null
      };

      page.photos.push(photo);

      // Make family-photo-1 selected by default.
      if (config.id === 'family-photo-1') {
        state.selection.photoIdx = page.photos.length - 1;
      }

      // Apply any initial quarter-turn rotations declared
      // in the layout. This uses the existing rotatePhoto
      // helper (subject to the same file:// security rules).
      const turns = config.rotationTurns || 0;
      if (turns > 0) {
        const originalPage = state.document.currentPage;
        state.document.currentPage = 0;
        const photoIndex = page.photos.length - 1;
        for (let i = 0; i < turns; i++) {
          rotatePhoto(photoIndex);
        }
        state.document.currentPage = originalPage;
      } else {
        render();
      }
    };
    img.onerror = function() {
      alert('Failed to load image: ' + config.src);
    };
    img.src = config.src;
  });
}

function render() {
  // Preserve scroll position before re-rendering to prevent
  // mobile browsers from jumping to the top during drag/resize.
  const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
  const scrollY = window.pageYOffset || document.documentElement.scrollTop;

  app.innerHTML = '';
  renderCollagePage();
  // Update settings UI to reflect current page size
  updateSettingsUI();

  // Restore scroll position after DOM is rebuilt
  window.scrollTo(scrollX, scrollY);
}

// ============================================
// Global Control Functions
// ============================================

// Toggle the settings flyout visibility
function toggleSettings() {
  const flyout = document.getElementById('settings-flyout');
  flyout.classList.toggle('hidden');
}

// Toggle the help modal visibility
function toggleHelp(show) {
  const overlay = document.getElementById('help-overlay');
  if (show === undefined) {
    overlay.classList.toggle('hidden');
  } else {
    overlay.classList.toggle('hidden', !show);
  }
}

// Update settings UI to reflect current page size
function updateSettingsUI() {
  const page = state.document.pages[state.document.currentPage];
  const isLetter = page.size.width === PAGE_SIZE_LETTER.width && page.size.height === PAGE_SIZE_LETTER.height;
  const currentSizeValue = isLetter ? 'Letter' : 'A4';

  document.querySelectorAll('.settings-option').forEach(option => {
    const isActive = option.dataset.size === currentSizeValue;
    option.classList.toggle('active', isActive);
    option.style.fontWeight = isActive ? 'bold' : '';
    option.style.background = isActive ? '#e0f2ff' : '';
  });
}

// Initialize global control event handlers (called once on load)
function initGlobalControls() {
  // Print button
  document.getElementById('print-button').onclick = e => {
    e.stopPropagation();
    window.printCollage();
  };

  // Settings button
  document.getElementById('settings-button').onclick = e => {
    e.stopPropagation();
    toggleSettings();
  };

  // GitHub button
  document.getElementById('github-button').onclick = e => {
    e.stopPropagation();
    window.open('https://github.com/dj-louw/photo-collage-printer', '_blank');
  };

  // Help button
  document.getElementById('help-button').onclick = e => {
    e.stopPropagation();
    toggleHelp(true);
  };

  // Help close button
  document.getElementById('help-close-button').onclick = e => {
    e.stopPropagation();
    toggleHelp(false);
  };

  // Help overlay background click to close
  document.getElementById('help-overlay').onclick = e => {
    if (e.target === e.currentTarget) {
      toggleHelp(false);
    }
  };

  // Settings flyout options
  document.querySelectorAll('.settings-option').forEach(option => {
    option.onclick = e => {
      e.stopPropagation();
      window.changePageSize(option.dataset.size);
      toggleSettings();
    };
  });

  // Close settings flyout when clicking elsewhere
  document.addEventListener('click', e => {
    const flyout = document.getElementById('settings-flyout');
    const settingsBtn = document.getElementById('settings-button');
    if (!flyout.classList.contains('hidden') &&
        !flyout.contains(e.target) &&
        !settingsBtn.contains(e.target)) {
      flyout.classList.add('hidden');
    }
  });

  // Wire up hidden file input onchange
  document.getElementById('photo-file-input').onchange = e => importPhoto(e);
}

// ============================================
// Helper functions for renderCollagePage
// ============================================

// Create the inner mask and image element for a photo container
function createPhotoMask(photo, pageIndex, idx) {
  const mask = document.createElement('div');
  mask.className = 'photo-mask';

  const img = document.createElement('img');
  img.src = photo.src;
  img.className = 'photo';
  img.style.left = (photo.imageOffsetX || 0) + 'px';
  img.style.top = (photo.imageOffsetY || 0) + 'px';
  img.style.width = photo.imageWidth + 'px';
  img.style.height = photo.imageHeight + 'px';
  img.onclick = e => {
    e.stopPropagation();
    selectPhoto(pageIndex, idx);
  };
  img.onpointerdown = e => {
    handlePointerDownOnImage(e.pageX, e.pageY, img, e);
  };

  mask.appendChild(img);

  // Overlay crop mask border strips if a mask is active
  if (photo.cropMask && CROP_MASKS[photo.cropMask]) {
    const m = CROP_MASKS[photo.cropMask];
    const topPx = m.top * PX_PER_MM;
    const rightPx = m.right * PX_PER_MM;
    const bottomPx = m.bottom * PX_PER_MM;
    const leftPx = m.left * PX_PER_MM;
    const strips = [
      { top: '0', left: '0', width: '100%', height: topPx + 'px' },
      { bottom: '0', left: '0', width: '100%', height: bottomPx + 'px' },
      { top: topPx + 'px', left: '0', width: leftPx + 'px', bottom: bottomPx + 'px' },
      { top: topPx + 'px', right: '0', width: rightPx + 'px', bottom: bottomPx + 'px' }
    ];
    strips.forEach(s => {
      const strip = document.createElement('div');
      strip.className = 'crop-mask-strip';
      strip.style.position = 'absolute';
      strip.style.background = m.color;
      strip.style.zIndex = '1';
      strip.style.pointerEvents = 'none';
      Object.keys(s).forEach(k => { strip.style[k] = s[k]; });
      mask.appendChild(strip);
    });
  }

  return mask;
}

// Return the minimum photo box size accounting for crop mask insets.
function getMinPhotoSize(photo) {
  if (photo.cropMask && CROP_MASKS[photo.cropMask]) {
    const m = CROP_MASKS[photo.cropMask];
    return {
      width: (m.left + m.right) * PX_PER_MM + MIN_PHOTO_SIZE_PX,
      height: (m.top + m.bottom) * PX_PER_MM + MIN_PHOTO_SIZE_PX
    };
  }
  return { width: MIN_PHOTO_SIZE_PX, height: MIN_PHOTO_SIZE_PX };
}

// Show the crop mask selection modal for the given photo.
function showCropMaskModal(pageIndex, photoIdx) {
  const page = state.document.pages[pageIndex];
  if (!page) return;
  const photo = page.photos[photoIdx];
  if (!photo) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay crop-mask-overlay';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  const modal = document.createElement('div');
  modal.className = 'modal';

  const title = document.createElement('div');
  title.className = 'modal__title';
  title.textContent = 'Crop Mask';
  modal.appendChild(title);

  const content = document.createElement('div');
  content.className = 'modal__content';

  const options = [{ key: null, label: 'None' }];
  Object.entries(CROP_MASKS).forEach(([key, m]) => {
    options.push({ key, label: m.label });
  });

  options.forEach(opt => {
    const row = document.createElement('div');
    row.className = 'flyout__row';
    row.style.cursor = 'pointer';

    const radio = document.createElement('div');
    radio.className = 'flyout__radio' +
      (photo.cropMask === opt.key ? ' flyout__radio--selected' : '');
    row.appendChild(radio);

    const label = document.createElement('div');
    label.className = 'flyout__label';
    label.textContent = opt.label;
    row.appendChild(label);

    row.onclick = () => {
      photo.cropMask = opt.key;

      // Enforce minimum size when applying a mask
      if (opt.key) {
        const minSize = getMinPhotoSize(photo);
        if (photo.width < minSize.width) photo.width = minSize.width;
        if (photo.height < minSize.height) photo.height = minSize.height;
      }

      overlay.remove();
      render();
    };

    content.appendChild(row);
  });

  // Separator before delete
  const separator = document.createElement('div');
  separator.className = 'modal__separator';
  content.appendChild(separator);

  // Delete button row
  const deleteRow = document.createElement('div');
  deleteRow.className = 'flyout__row flyout__row--danger';
  deleteRow.style.cursor = 'pointer';

  const deleteIcon = document.createElement('img');
  deleteIcon.src = 'icons/delete-outline.svg';
  deleteIcon.alt = 'Delete photo';
  deleteIcon.className = 'photo-size-info__icon';
  deleteIcon.style.marginRight = '8px';
  deleteRow.appendChild(deleteIcon);

  const deleteLabel = document.createElement('div');
  deleteLabel.className = 'flyout__label';
  deleteLabel.textContent = 'Delete photo';
  deleteRow.appendChild(deleteLabel);

  deleteRow.onclick = () => {
    overlay.remove();
    deletePhoto(pageIndex, photoIdx);
  };

  content.appendChild(deleteRow);

  modal.appendChild(content);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// Create resize handles for the selected photo
function createResizeHandles(pageIndex, idx, photo, inCropMode, container) {
  const handlePositions = inCropMode
    ? [
        { name: 's', left: '50%', bottom: CONTROL_INSET_PX + 'px', cursor: 'ns-resize', transform: 'translateX(-50%)' },
        { name: 'w', left: CONTROL_INSET_PX + 'px', top: '50%', cursor: 'ew-resize', transform: 'translateY(-50%)' },
        { name: 'e', right: CONTROL_INSET_PX + 'px', top: '50%', cursor: 'ew-resize', transform: 'translateY(-50%)' }
      ]
    : [
        { name: 'se', right: -(HANDLE_SIZE_PX + CONTROL_INSET_PX) + 'px', bottom: -(HANDLE_SIZE_PX + CONTROL_INSET_PX) + 'px', cursor: 'nwse-resize' }
      ];

  handlePositions.forEach(pos => {
    const handle = document.createElement('div');
    let handleClass = 'resize-handle image-resize-handle';
    if (
      state.resize.active &&
      state.resize.photoIdx === idx &&
      state.resize.orig &&
      state.resize.orig.kind === 'box' &&
      state.resize.orig.handle === pos.name
    ) {
      handleClass += ' handle-active';
    }
    handleClass += inCropMode ? ' resize-handle--square' : ' resize-handle--round';
    handle.className = handleClass;
    if (pos.left) handle.style.left = pos.left;
    if (pos.right) handle.style.right = pos.right;
    if (pos.top) handle.style.top = pos.top;
    if (pos.bottom) handle.style.bottom = pos.bottom;
    if (pos.transform) handle.style.transform = pos.transform;
    handle.style.cursor = pos.cursor;
    handle.setAttribute('data-handle', pos.name);

    handle.onpointerdown = e => {
      state.document.currentPage = pageIndex;
      startResize(e, idx, pos.name);
    };

    // Non-crop resize handle icon
    if (!inCropMode && pos.name === 'se') {
      const icon = document.createElement('img');
      icon.src = 'icons/arrow-top-left-bottom-right.svg';
      icon.alt = 'Resize';
      icon.className = 'resize-handle__icon';
      handle.appendChild(icon);
    }

    // Crop mode directional icons
    if (inCropMode) {
      let cropIconSrc = null;
      let cropIconAlt = '';
      if (pos.name === 'e') {
        cropIconSrc = 'icons/arrow-expand-left.svg';
        cropIconAlt = 'Crop inward from right';
      } else if (pos.name === 'w') {
        cropIconSrc = 'icons/arrow-expand-right.svg';
        cropIconAlt = 'Crop inward from left';
      } else if (pos.name === 's') {
        cropIconSrc = 'icons/arrow-expand-up.svg';
        cropIconAlt = 'Crop inward from bottom';
      }

      if (cropIconSrc) {
        const cropIconImg = document.createElement('img');
        cropIconImg.src = cropIconSrc;
        cropIconImg.alt = cropIconAlt;
        cropIconImg.className = 'resize-handle__icon';
        handle.appendChild(cropIconImg);
      }
    }

    // Counter-scale based on position
    let handleOrigin = 'center center';
    if (pos.name === 's') handleOrigin = 'bottom center';
    else if (pos.name === 'w') handleOrigin = 'left center';
    else if (pos.name === 'e') handleOrigin = 'right center';
    else if (pos.name === 'se') handleOrigin = 'bottom right';
    applyCounterScale(handle, handleOrigin);

    container.appendChild(handle);
  });
}

// Create the image frame for crop mode zooming
function createImageFrame(pageIndex, idx, photo, container) {
  const imageFrame = document.createElement('div');
  imageFrame.className = 'image-frame';
  imageFrame.style.left = (photo.imageOffsetX || 0) + 'px';
  imageFrame.style.top = (photo.imageOffsetY || 0) + 'px';
  imageFrame.style.width = photo.imageWidth + 'px';
  imageFrame.style.height = photo.imageHeight + 'px';

  const imgHandle = document.createElement('div');
  let imgHandleClass = 'resize-handle image-resize-handle';
  if (
    state.resize.active &&
    state.resize.photoIdx === idx &&
    state.resize.orig &&
    state.resize.orig.kind === 'image' &&
    state.resize.orig.handle === 'se'
  ) {
    imgHandleClass += ' handle-active';
  }
  imgHandle.className = imgHandleClass + ' resize-handle--round';
  imgHandle.style.right = CONTROL_INSET_PX + 'px';
  imgHandle.style.bottom = CONTROL_INSET_PX + 'px';
  imgHandle.style.cursor = 'nwse-resize';
  imgHandle.setAttribute('data-handle', 'se');

  imgHandle.onpointerdown = e => {
    state.document.currentPage = pageIndex;
    startImageResize(e, idx, 'se');
  };

  const handleIcon = document.createElement('img');
  handleIcon.src = 'icons/arrow-top-left-bottom-right.svg';
  handleIcon.alt = 'Resize image';
  handleIcon.className = 'resize-handle__icon';
  imgHandle.appendChild(handleIcon);

  applyCounterScale(imgHandle, 'bottom right');
  imageFrame.appendChild(imgHandle);
  container.appendChild(imageFrame);
}

// Create photo control buttons (rotate, crop, ratio presets)
function createPhotoControls(pageIndex, idx, inCropMode, container) {
  const outsideTop = -(BUTTON_SIZE_LG_PX + CONTROL_INSET_PX) + 'px';

  // Rotate button
  const rotateButton = createIconButton({
    iconSrc: 'icons/file-rotate-right.svg',
    alt: 'Rotate',
    onClick: e => {
      e.stopPropagation();
      state.document.currentPage = pageIndex;
      rotatePhoto(idx);
    },
    position: { left: '0', top: outsideTop },
    counterScale: 'bottom left',
  });
  container.appendChild(rotateButton);

  // Crop button
  const cropButton = createIconButton({
    iconSrc: 'icons/crop.svg',
    alt: 'Crop',
    onClick: e => {
      e.stopPropagation();
      state.document.currentPage = pageIndex;
      toggleCrop(idx);
    },
    extraClasses: 'crop-toggle',
    position: { left: (BUTTON_SIZE_LG_PX + CONTROL_INSET_PX) + 'px', top: outsideTop },
    counterScale: 'bottom left',
  });
  container.appendChild(cropButton);

  // Aspect-ratio preset buttons (only in crop mode)
  if (inCropMode) {
    const buttonSpacing = BUTTON_SIZE_LG_PX + CONTROL_INSET_PX;
    const ratioButtons = [
      { mode: '4:3', icon: 'icons/crop-landscape.svg', offset: buttonSpacing * 2, alt: 'Crop 4:3 landscape' },
      { mode: '3:4', icon: 'icons/crop-portrait.svg', offset: buttonSpacing * 3, alt: 'Crop 3:4 portrait' },
      { mode: '1:1', icon: 'icons/crop-square.svg', offset: buttonSpacing * 4, alt: 'Crop 1:1 square' }
    ];

    ratioButtons.forEach(cfg => {
      const isActive = state.crop.aspectMode === cfg.mode;
      const btn = createIconButton({
        iconSrc: cfg.icon,
        alt: cfg.alt,
        onClick: e => {
          e.stopPropagation();
          state.document.currentPage = pageIndex;

          const pageForAspect = state.document.pages[state.document.currentPage];
          const photoForAspect = pageForAspect.photos[idx];

          if (state.crop.aspectMode === cfg.mode) {
            state.crop.aspectMode = null;
          } else {
            state.crop.aspectMode = cfg.mode;
            applyCropAspectPreset(photoForAspect, pageForAspect, cfg.mode);
          }
          render();
        },
        extraClasses: 'crop-ratio-toggle' + (isActive ? ' crop-ratio-active' : ''),
        position: { left: cfg.offset + 'px', top: outsideTop },
        counterScale: 'bottom left',
      });
      container.appendChild(btn);
    });
  }

}

// Create the size info readout for a selected photo
function createSizeInfo(photo, container) {
  const wPx = Math.max(1, photo.width);
  const hPx = Math.max(1, photo.height);
  const wInt = Math.round(wPx);
  const hInt = Math.round(hPx);
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(wInt, hInt) || 1;
  const arW = Math.round(wInt / g);
  const arH = Math.round(hInt / g);
  const mmWidth = wPx / PX_PER_MM;
  const mmHeight = hPx / PX_PER_MM;

  const info = document.createElement('div');
  info.className = 'photo-size-info';
  info.setAttribute('data-html2canvas-ignore', 'true');
  info.style.left = 'calc(100% + ' + CONTROL_INSET_PX + 'px)';
  info.style.top = (BUTTON_SIZE_LG_PX + CONTROL_INSET_PX) + 'px';

  const aspectLine = document.createElement('div');
  aspectLine.textContent = arW + ' : ' + arH;

  const widthLine = document.createElement('div');
  widthLine.className = 'photo-size-info__line';
  const widthIcon = document.createElement('img');
  widthIcon.src = 'icons/arrow-expand-horizontal.svg';
  widthIcon.alt = 'Width';
  widthIcon.className = 'photo-size-info__icon';
  const widthText = document.createElement('span');
  widthText.textContent = mmWidth.toFixed(1) + ' mm';
  widthLine.appendChild(widthIcon);
  widthLine.appendChild(widthText);

  const heightLine = document.createElement('div');
  heightLine.className = 'photo-size-info__line';
  const heightIcon = document.createElement('img');
  heightIcon.src = 'icons/arrow-expand-vertical.svg';
  heightIcon.alt = 'Height';
  heightIcon.className = 'photo-size-info__icon';
  const heightText = document.createElement('span');
  heightText.textContent = mmHeight.toFixed(1) + ' mm';
  heightLine.appendChild(heightIcon);
  heightLine.appendChild(heightText);

  info.appendChild(aspectLine);
  info.appendChild(widthLine);
  info.appendChild(heightLine);
  applyCounterScale(info, 'left top');
  container.appendChild(info);
}

// Create Add Page and Delete Page buttons below the active page
function createPageActions(pageWidthPx, scale) {
  const actions = document.createElement('div');
  actions.className = 'page-actions';
  actions.style.width = (pageWidthPx * scale) + 'px';
  actions.style.height = BUTTON_SIZE_LG_PX + 'px';

  // Add Page button (centred)
  const addButton = createIconButton({
    iconSrc: 'icons/plus.svg',
    alt: 'Add page',
    onClick: e => {
      e.stopPropagation();
      window.addPage();
    },
    size: 'lg',
    extraClasses: 'page-add-button',
    position: { left: '50%', top: '0', transform: 'translateX(-50%)' },
    ignoreCanvas: false,
  });
  actions.appendChild(addButton);

  // Delete Page button (left-aligned), hidden if only one page
  if (state.document.pages.length > 1) {
    const deletePageButton = createIconButton({
      iconSrc: 'icons/file-remove-outline.svg',
      alt: 'Delete page',
      onClick: e => {
        e.stopPropagation();
        window.removePage();
      },
      size: 'lg',
      extraClasses: 'page-delete-button',
      position: { left: '0', top: '0' },
      ignoreCanvas: false,
    });
    actions.appendChild(deletePageButton);
  }

  return actions;
}

function renderCollagePage() {
  // Render all pages vertically, like a word processor
  // document. The currentPage index still tracks which
  // page new photos are added to and which one the
  // page controls refer to, but you can scroll through
  // and interact with every page.
  state.document.pages.forEach((page, pageIndex) => {
    const div = document.createElement('div');
    const pageClasses = ['collage-page'];
    if (pageIndex === state.document.currentPage) {
      pageClasses.push('active-page');
    }
    div.className = pageClasses.join(' ');
    const pageWidthPx = page.size.width * PX_PER_MM;
    const pageHeightPx = page.size.height * PX_PER_MM;
    div.style.width = pageWidthPx + 'px';
    div.style.height = pageHeightPx + 'px';
    div.dataset.pageIndex = String(pageIndex);

    // Clicking on empty space on a page clears any
    // current selection/crop and makes that page the
    // active one for subsequent operations.
    div.addEventListener('click', e => {
      const photoContainer = e.target.closest('.photo-container');
      if (!photoContainer) {
        state.document.currentPage = pageIndex;
        state.selection.photoIdx = null;
        state.crop.active = false;
        state.crop.photoIdx = null;
        render();
      }
    });

    // For the active page, show an Add Image button attached
    // to the left edge at the top, using the same plus icon
    // as Add Page. It triggers the hidden file input.
    if (pageIndex === state.document.currentPage) {
      const addImageButton = createIconButton({
        iconSrc: 'icons/image-plus.svg',
        alt: 'Add image',
        onClick: e => {
          e.stopPropagation();
          const input = document.getElementById('photo-file-input');
          if (input) {
            input.click();
          }
        },
        size: 'lg',
        extraClasses: 'page-add-image-button',
        position: { left: '-' + ADD_IMAGE_BUTTON_OFFSET_PX + 'px', top: '0' },
        // Counter-scale so button stays at original size; anchor
        // at right edge so it grows leftward away from the page.
        counterScale: 'right center',
      });
      div.appendChild(addImageButton);
    }

    page.photos.forEach((photo, idx) => {
    // Backwards compatibility: ensure new image fields exist
    if (photo.imageWidth == null || photo.imageHeight == null) {
      photo.imageWidth = photo.width;
      photo.imageHeight = photo.height;
      photo.imageOffsetX = 0;
      photo.imageOffsetY = 0;
    }

    // Container: positions the photo on the page and
    // carries the selection frame/border (only when
    // the photo on the active page is selected).
    const container = document.createElement('div');
    const classes = ['photo-container'];
    const isOnActivePage = pageIndex === state.document.currentPage;
    const isSelectedOnActivePage = isOnActivePage && state.selection.photoIdx === idx;
    if (isSelectedOnActivePage) classes.push('selected');
    if (state.crop.active && isOnActivePage && state.crop.photoIdx === idx) classes.push('cropping-active');
    container.className = classes.join(' ');
    container.style.position = 'absolute';
    container.style.left = photo.x + 'px';
    container.style.top = photo.y + 'px';
    container.style.width = photo.width + 'px';
    container.style.height = photo.height + 'px';
    container.style.pointerEvents = 'auto';
    container.dataset.pageIndex = String(pageIndex);
    container.dataset.photoIndex = String(idx);

    // Create the inner mask and image using helper
    const mask = createPhotoMask(photo, pageIndex, idx);
    container.appendChild(mask);

    // Show resize/crop handles only for the selected
    // photo on the active page.
    if (isSelectedOnActivePage) {
      const inCropMode = state.crop.active && state.crop.photoIdx === idx;

      // Create resize handles using helper
      createResizeHandles(pageIndex, idx, photo, inCropMode, container);

      // In crop mode, show the image frame for zooming
      if (inCropMode) {
        createImageFrame(pageIndex, idx, photo, container);
      }

      // Create photo control buttons using helper
      createPhotoControls(pageIndex, idx, inCropMode, container);

      // Gear button for crop mask settings (outside top-right)
      const gearButton = createIconButton({
        iconSrc: 'icons/dots-vertical.svg',
        alt: 'Crop mask settings',
        onClick: e => {
          e.stopPropagation();
          showCropMaskModal(pageIndex, idx);
        },
        position: { right: -(BUTTON_SIZE_LG_PX + CONTROL_INSET_PX) + 'px', top: '0' },
        counterScale: 'bottom left',
      });
      container.appendChild(gearButton);

      // Create size info readout using helper
      createSizeInfo(photo, container);
    }

    div.appendChild(container);
  });

  // Calculate and apply responsive scaling
  const scale = calculatePageScale(pageWidthPx);
  state.ui.pageScale = scale;
  
  if (scale < 1) {
    div.style.transform = `scale(${scale})`;
    div.style.transformOrigin = 'top left';
  }

  // Wrap page in a container that reserves the correct
  // scaled dimensions and centers the page.
  const wrapper = document.createElement('div');
  wrapper.className = 'collage-page-wrapper';
  wrapper.style.width = (pageWidthPx * scale) + 'px';
  wrapper.style.height = (pageHeightPx * scale) + 'px';
  wrapper.style.marginBottom = '24px';
  wrapper.appendChild(div);
  app.appendChild(wrapper);

  // For the currently active page, show page control buttons
  if (pageIndex === state.document.currentPage) {
    const actions = createPageActions(pageWidthPx, scale);
    app.appendChild(actions);
  }
  });
}

// Page controls
window.addPage = function() {
  state.document.pages.push({ size: { ...PAGE_SIZE_A4 }, photos: [] });
  state.document.currentPage = state.document.pages.length - 1;
  render();
};

window.removePage = function() {
  if (state.document.pages.length > 1) {
    state.document.pages.splice(state.document.currentPage, 1);
    state.document.currentPage = Math.max(0, state.document.currentPage - 1);
    state.selection.photoIdx = null;
    render();
  }
};

window.changePageSize = function(size) {
  const sizes = {
    'A4': PAGE_SIZE_A4,
    'Letter': PAGE_SIZE_LETTER
  };
  state.document.pages[state.document.currentPage].size = { ...sizes[size] };
  render();
};

// Apply an aspect-ratio preset to the current crop box.
// This adjusts the box dimensions immediately when a
// ratio button is clicked, before enforcing it during
// subsequent resize operations.
function applyCropAspectPreset(photo, page, mode) {
  if (!photo || !page) return;

  let desiredWidth = photo.width;
  let desiredHeight = photo.height;

  if (mode === '4:3') {
    // Landscape: 150mm × 100mm
    desiredWidth = CROP_PRESET_4_3_WIDTH_MM * PX_PER_MM;
    desiredHeight = CROP_PRESET_4_3_HEIGHT_MM * PX_PER_MM;
  } else if (mode === '3:4') {
    // Portrait: 100mm × 150mm
    desiredWidth = CROP_PRESET_3_4_WIDTH_MM * PX_PER_MM;
    desiredHeight = CROP_PRESET_3_4_HEIGHT_MM * PX_PER_MM;
  } else if (mode === '1:1') {
    // Square: keep roughly the current box size but enforce 1:1.
    const side = Math.min(photo.width, photo.height);
    desiredWidth = side;
    desiredHeight = side;
  }

  if (desiredWidth <= 0 || desiredHeight <= 0) return;

  const pageWidth = page.size.width * PX_PER_MM;
  const pageHeight = page.size.height * PX_PER_MM;

  // Compute a uniform scale so the desired box fits within
  // the page. The crop box may extend beyond the image.
  let scale = 1;
  scale = Math.min(
    scale,
    pageWidth / desiredWidth,
    pageHeight / desiredHeight
  );

  if (!Number.isFinite(scale) || scale <= 0) {
    scale = 1;
  }

  let targetWidth = desiredWidth * scale;
  let targetHeight = desiredHeight * scale;

  const minSize = getMinPhotoSize(photo);
  if (targetWidth < minSize.width || targetHeight < minSize.height) {
    const upScale = Math.max(minSize.width / targetWidth, minSize.height / targetHeight);
    targetWidth *= upScale;
    targetHeight *= upScale;
  }

  // Position the new crop box roughly around the previous
  // visual centre, then clamp it inside the page.
  const oldCenterX = photo.x + photo.width / 2;
  const oldCenterY = photo.y + photo.height / 2;

  let newX = oldCenterX - targetWidth / 2;
  let newY = oldCenterY - targetHeight / 2;

  if (newX < 0) newX = 0;
  if (newY < 0) newY = 0;
  if (newX + targetWidth > pageWidth) newX = pageWidth - targetWidth;
  if (newY + targetHeight > pageHeight) newY = pageHeight - targetHeight;

  photo.x = newX;
  photo.y = newY;
  photo.width = targetWidth;
  photo.height = targetHeight;
}

// Delete a photo from a specific page and clear any
// selection/crop state on that page.
function deletePhoto(pageIndex, idx) {
  const page = state.document.pages[pageIndex];
  if (!page) return;
  if (idx < 0 || idx >= page.photos.length) return;

  page.photos.splice(idx, 1);

  if (pageIndex === state.document.currentPage) {
    state.selection.photoIdx = null;
    state.crop.active = false;
    state.crop.photoIdx = null;
  }

  render();
}

// Photo controls
window.importPhoto = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(ev) {
    const img = new Image();
    img.onload = function() {
      const page = state.document.pages[state.document.currentPage];
      const pageWidthPx = page.size.width * PX_PER_MM;
      const targetWidth = pageWidthPx * 0.5; // 50% of page width
      const scale = targetWidth / img.naturalWidth;
      const width = targetWidth;
      const height = img.naturalHeight * scale;

      page.photos.push({
        src: ev.target.result,
        x: 10,
        y: 10,
        width,
        height,
        rotation: 0,
        imageWidth: width,
        imageHeight: height,
        imageOffsetX: 0,
        imageOffsetY: 0,
        cropMask: null
      });
      state.selection.photoIdx = page.photos.length - 1;
      render();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
};

window.printCollage = async function() {
  const pageEls = document.querySelectorAll('.collage-page');
  if (!pageEls.length || !window.jspdf || !window.html2canvas) {
    // Fallback to normal print if libraries are unavailable
    window.print();
    return;
  }

  const { jsPDF } = window.jspdf;

  // Temporarily hide selection chrome while capturing
  document.body.classList.add('printing-pdf');

  // Determine PDF page size based on user's selected page size
  const pageSize = state.document.pages[0].size;
  const isLetter = pageSize.width === 216 && pageSize.height === 279;
  const pdfFormat = isLetter ? 'letter' : 'a4';
  const pdf = new jsPDF('portrait', 'mm', pdfFormat);
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  let firstPage = true;
  for (let i = 0; i < pageEls.length; i++) {
    const pageEl = pageEls[i];
    // Render each collage page to a high-resolution canvas
    const canvas = await window.html2canvas(pageEl, { scale: PDF_EXPORT_SCALE });
    const imgData = canvas.toDataURL('image/png');

    const imgWidth = canvas.width;
    const imgHeight = canvas.height;
    const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
    const renderWidth = imgWidth * ratio;
    const renderHeight = imgHeight * ratio;
    const x = (pdfWidth - renderWidth) / 2;
    const y = (pdfHeight - renderHeight) / 2;

    if (!firstPage) {
      pdf.addPage();
    }
    pdf.addImage(imgData, 'PNG', x, y, renderWidth, renderHeight);
    firstPage = false;
  }

  // Download the PDF so the user can open/print it
  // from their PDF viewer, avoiding browser security
  // restrictions around blob URLs on file:// origins.
  pdf.save('collage.pdf');

  // Restore normal view
  document.body.classList.remove('printing-pdf');
};

// Selection helper
function selectPhoto(pageIndex, idx) {
  state.document.currentPage = pageIndex;
  state.selection.photoIdx = idx;
  // Leaving crop mode when switching selection keeps
  // the interaction model simple across pages.
  state.crop.active = false;
  state.crop.photoIdx = null;
  render();
}
function toggleCrop(idx) {
  // Toggle crop mode for a given photo. Crops are non-destructive:
  // we never alter the underlying photo.src, only how it is shown
  // inside its bounding box via imageWidth/Height and offsets.
  if (state.crop.active && state.crop.photoIdx === idx) {
    // Turning crop mode off for the same photo simply exits the
    // editing experience; the current mask stays in effect.
    state.crop.active = false;
    state.crop.photoIdx = null;
    render();
    return;
  }

  // Switch crop focus to another photo (no commit step required).
  state.crop.active = true;
  state.crop.photoIdx = idx;
  state.selection.photoIdx = idx;
  render();
}

// Rotate photo by 90 degrees clockwise by redrawing the bitmap.
// This avoids CSS transform artefacts like letterboxing/cropping
// because the underlying image data itself is rotated.
function rotatePhoto(idx) {
  const page = state.document.pages[state.document.currentPage];
  const photo = page.photos[idx];

   // When the app is opened directly from the file system
   // (file://) and a photo comes from a local path rather
   // than a data: URL, browsers will treat the canvas as
   // "tainted" and throw a security error when we call
   // toDataURL. In that case, bail out gracefully and
   // explain how to enable rotation.
   if (location.protocol === 'file:' && !/^data:/i.test(photo.src)) {
     if (!window.__rotationFileWarningShown) {
       window.__rotationFileWarningShown = true;
       alert('To rotate the built-in sample photos, please open this app via a local web server (http://…) or import the images using the Add Photo button. Browsers block rotating file:// images for security reasons.');
     }
     return;
   }

  // Ensure image presentation fields exist
  if (photo.imageWidth == null || photo.imageHeight == null) {
    photo.imageWidth = photo.width;
    photo.imageHeight = photo.height;
    photo.imageOffsetX = photo.imageOffsetX || 0;
    photo.imageOffsetY = photo.imageOffsetY || 0;
  }

  const img = new Image();
  img.onload = function() {
    const imgW = img.width;
    const imgH = img.height;
    if (!imgW || !imgH) return;

    const imageWidth = photo.imageWidth;
    const imageHeight = photo.imageHeight;

    // Describe the current crop as normalized coordinates
    // relative to the drawn image (0..1).
    let fw = imageWidth ? photo.width / imageWidth : 1;  // width fraction
    let fh = imageHeight ? photo.height / imageHeight : 1; // height fraction
    let leftNorm = imageWidth ? -(photo.imageOffsetX || 0) / imageWidth : 0;
    let topNorm = imageHeight ? -(photo.imageOffsetY || 0) / imageHeight : 0;

    // Clamp to a sane range
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    fw = clamp(fw, 0, 1);
    fh = clamp(fh, 0, 1);
    leftNorm = clamp(leftNorm, 0, 1 - fw);
    topNorm = clamp(topNorm, 0, 1 - fh);

    let cx = leftNorm + fw / 2;
    let cy = topNorm + fh / 2;
    cx = clamp(cx, 0, 1);
    cy = clamp(cy, 0, 1);

    // Rotate the crop rectangle 90° clockwise around the
    // image centre in normalized space.
    const fwRot = fh;
    const fhRot = fw;
    let cxRot = cy;
    let cyRot = 1 - cx;
    cxRot = clamp(cxRot, 0, 1);
    cyRot = clamp(cyRot, 0, 1);

    // Compute the scale (drawn image size vs intrinsic)
    const scale = imgW ? imageWidth / imgW : 1;

    // Create a canvas with swapped dimensions for 90° rotation
    const canvas = document.createElement('canvas');
    canvas.width = imgH;
    canvas.height = imgW;
    const ctx = canvas.getContext('2d');

    // Rotate around the canvas center and draw the image
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2); // 90 degrees clockwise
    ctx.drawImage(img, -img.width / 2, -img.height / 2);

    let newSrc;
    try {
      newSrc = canvas.toDataURL('image/png');
    } catch (err) {
      console.warn('Unable to rotate image due to browser security restrictions.', err);
      return;
    }

    // New drawn image size keeps the same zoom level
    const newImageWidth = imgH * scale;
    const newImageHeight = imgW * scale;

    // Apply the rotated crop fractions to the new image
    const newWidth = fwRot * newImageWidth;
    const newHeight = fhRot * newImageHeight;
    const newLeftNorm = clamp(cxRot - fwRot / 2, 0, 1 - fwRot);
    const newTopNorm = clamp(cyRot - fhRot / 2, 0, 1 - fhRot);
    const newOffsetX = -newLeftNorm * newImageWidth;
    const newOffsetY = -newTopNorm * newImageHeight;

    // Keep the visual centre roughly the same on the page
    const oldCenterX = photo.x + photo.width / 2;
    const oldCenterY = photo.y + photo.height / 2;
    let newX = oldCenterX - newWidth / 2;
    let newY = oldCenterY - newHeight / 2;

    const pageWidth = page.size.width * PX_PER_MM;
    const pageHeight = page.size.height * PX_PER_MM;

    if (newX < 0) newX = 0;
    if (newY < 0) newY = 0;
    if (newX + newWidth > pageWidth) newX = pageWidth - newWidth;
    if (newY + newHeight > pageHeight) newY = pageHeight - newHeight;

    photo.src = newSrc;
    photo.width = newWidth;
    photo.height = newHeight;
    photo.x = newX;
    photo.y = newY;

    photo.imageWidth = newImageWidth;
    photo.imageHeight = newImageHeight;
    photo.imageOffsetX = newOffsetX;
    photo.imageOffsetY = newOffsetY;

    render();
  };

  img.src = photo.src;
}

// Expose rotation for any global handlers (defensive)
window.rotatePhoto = rotatePhoto;

// Resize start
function startResize(e, idx, handle) {
  e.stopPropagation();
  e.preventDefault();
  // Track the active handle element so we can style it
  // as pressed while the user is dragging.
  if (state.resize.handleElement && state.resize.handleElement !== e.currentTarget) {
    state.resize.handleElement.classList.remove('handle-active');
  }
  state.resize.handleElement = e.currentTarget || e.target;
  if (state.resize.handleElement) {
    state.resize.handleElement.classList.add('handle-active');
  }
  // Capture the pointer for reliable tracking during resize
  if (e.pointerId !== undefined && state.resize.handleElement && state.resize.handleElement.setPointerCapture) {
    try {
      state.resize.handleElement.setPointerCapture(e.pointerId);
      state.pointer.activeId = e.pointerId;
      state.pointer.capturedElement = state.resize.handleElement;
    } catch (err) {
      // Pointer capture may fail in some edge cases; ignore.
    }
  }
  state.resize.active = true;
  state.resize.photoIdx = idx;
  state.resize.start = { x: e.pageX, y: e.pageY };
  const photo = state.document.pages[state.document.currentPage].photos[idx];
  state.resize.orig = {
    kind: 'box',
    width: photo.width,
    height: photo.height,
    x: photo.x,
    y: photo.y,
    handle,
    dominant: null,
    imageWidth: photo.imageWidth,
    imageHeight: photo.imageHeight,
    imageOffsetX: photo.imageOffsetX || 0,
    imageOffsetY: photo.imageOffsetY || 0
  };
}

// Resize the underlying image while in crop mode (zoom in/out)
function startImageResize(e, idx, handle) {
  e.stopPropagation();
  e.preventDefault();
  if (state.resize.handleElement && state.resize.handleElement !== e.currentTarget) {
    state.resize.handleElement.classList.remove('handle-active');
  }
  state.resize.handleElement = e.currentTarget || e.target;
  if (state.resize.handleElement) {
    state.resize.handleElement.classList.add('handle-active');
  }
  // Capture the pointer for reliable tracking during resize
  if (e.pointerId !== undefined && state.resize.handleElement && state.resize.handleElement.setPointerCapture) {
    try {
      state.resize.handleElement.setPointerCapture(e.pointerId);
      state.pointer.activeId = e.pointerId;
      state.pointer.capturedElement = state.resize.handleElement;
    } catch (err) {
      // Pointer capture may fail in some edge cases; ignore.
    }
  }
  state.resize.active = true;
  state.resize.photoIdx = idx;
  state.resize.start = { x: e.pageX, y: e.pageY };
  const photo = state.document.pages[state.document.currentPage].photos[idx];
  state.resize.orig = {
    kind: 'image',
    width: photo.width,
    height: photo.height,
    x: photo.x,
    y: photo.y,
    handle,
    dominant: null,
    imageWidth: photo.imageWidth,
    imageHeight: photo.imageHeight,
    imageOffsetX: photo.imageOffsetX || 0,
    imageOffsetY: photo.imageOffsetY || 0
  };
}

// Global pointer handlers for drag + resize
function handlePointerDownOnImage(pageX, pageY, target, originalEvent) {
  // Ignore obvious controls such as resize handles and
  // circular icon buttons – they manage their own
  // interactions.
  if (target.closest && target.closest('.resize-handle')) {
    return;
  }

  // Start drag when interacting anywhere inside a photo
  // container (image or its mask/overlay), so drags
  // initiated within the active page are consistently
  // recognised.
  const container = target.closest && target.closest('[data-photo-index]');
  if (!container) return;
  const pageIndex = container.dataset.pageIndex ? Number(container.dataset.pageIndex) : 0;
  const idx = Number(container.dataset.photoIndex);
  if (Number.isNaN(idx) || Number.isNaN(pageIndex)) return;

  // Make the page containing this photo the active page
  // so all subsequent drag/resize logic uses the right
  // page dimensions and photo list.
  state.document.currentPage = pageIndex;
  const photo = state.document.pages[state.document.currentPage].photos[idx];
  // In crop mode on the active photo, dragging the image moves
  // the image under a stationary mask instead of moving the box.
  if (state.crop.active && state.crop.photoIdx === idx) {
    state.crop.draggingImage = true;
    state.crop.imageDragStart = { x: pageX, y: pageY };
    state.crop.imageOrigOffset = {
      x: photo.imageOffsetX || 0,
      y: photo.imageOffsetY || 0
    };
  } else {
    state.drag.photoIdx = idx;
    state.drag.active = true;
    state.drag.startPointer = { x: pageX, y: pageY };
    state.drag.startPosition = { x: photo.x, y: photo.y };
  }
  // Capture the pointer so we continue receiving events even
  // if the finger/pen moves outside the target element.
  if (originalEvent && originalEvent.pointerId !== undefined && target.setPointerCapture) {
    try {
      target.setPointerCapture(originalEvent.pointerId);
      state.pointer.activeId = originalEvent.pointerId;
      state.pointer.capturedElement = target;
    } catch (err) {
      // Pointer capture may fail in some edge cases; ignore.
    }
  }
  if (originalEvent && originalEvent.preventDefault) {
    originalEvent.preventDefault();
  }
}

// Use pointerdown instead of separate mousedown/touchstart
document.addEventListener('pointerdown', function(e) {
  handlePointerDownOnImage(e.pageX, e.pageY, e.target, e);
});

function handlePointerMove(pageX, pageY) {
  const pageWidth = state.document.pages[state.document.currentPage].size.width * PX_PER_MM;
  const pageHeight = state.document.pages[state.document.currentPage].size.height * PX_PER_MM;

   // Moving the image under a fixed crop mask
   if (state.crop.active && state.crop.draggingImage && state.crop.photoIdx !== null) {
     const photo = state.document.pages[state.document.currentPage].photos[state.crop.photoIdx];
     // Scale the screen delta to page coordinates
     const dx = (pageX - state.crop.imageDragStart.x) / state.ui.pageScale;
     const dy = (pageY - state.crop.imageDragStart.y) / state.ui.pageScale;

     let newOffsetX = state.crop.imageOrigOffset.x + dx;
     let newOffsetY = state.crop.imageOrigOffset.y + dy;

     const minOffsetX = Math.min(0, photo.width - photo.imageWidth);
     const maxOffsetX = 0;
     const minOffsetY = Math.min(0, photo.height - photo.imageHeight);
     const maxOffsetY = 0;

     if (newOffsetX < minOffsetX) newOffsetX = minOffsetX;
     if (newOffsetX > maxOffsetX) newOffsetX = maxOffsetX;
     if (newOffsetY < minOffsetY) newOffsetY = minOffsetY;
     if (newOffsetY > maxOffsetY) newOffsetY = maxOffsetY;

     photo.imageOffsetX = newOffsetX;
     photo.imageOffsetY = newOffsetY;
     render();
     return;
   }

  if (state.drag.active && state.drag.photoIdx !== null) {
    const photo = state.document.pages[state.document.currentPage].photos[state.drag.photoIdx];
    // Scale the screen delta to page coordinates
    const dx = (pageX - state.drag.startPointer.x) / state.ui.pageScale;
    const dy = (pageY - state.drag.startPointer.y) / state.ui.pageScale;
    let newX = state.drag.startPosition.x + dx;
    let newY = state.drag.startPosition.y + dy;
    newX = Math.max(0, Math.min(newX, pageWidth - photo.width));
    newY = Math.max(0, Math.min(newY, pageHeight - photo.height));
    photo.x = newX;
    photo.y = newY;
    render();
    return;
  }

  if (!state.resize.active || state.resize.photoIdx === null) return;
  const photo = state.document.pages[state.document.currentPage].photos[state.resize.photoIdx];
  // Scale screen delta to page coordinates
  const dx = (pageX - state.resize.start.x) / state.ui.pageScale;
  const dy = (pageY - state.resize.start.y) / state.ui.pageScale;

  // In crop mode, we can either resize the mask (container)
  // or the underlying image (zoom). Distinguish via kind.
  if (state.crop.active && state.crop.photoIdx === state.resize.photoIdx && state.resize.orig && state.resize.orig.kind === 'image') {
    // Resize the underlying image while keeping the mask fixed.
    let newImageWidth = state.resize.orig.imageWidth;
    let newImageHeight = state.resize.orig.imageHeight;
    let newOffsetX = state.resize.orig.imageOffsetX;
    let newOffsetY = state.resize.orig.imageOffsetY;

    let widthChange = 0;
    let heightChange = 0;

    if (state.resize.orig.handle === 'se') {
      widthChange = dx;
      heightChange = dy;
    } else if (state.resize.orig.handle === 'sw') {
      widthChange = -dx;
      heightChange = dy;
    } else if (state.resize.orig.handle === 'ne') {
      widthChange = dx;
      heightChange = -dy;
    } else if (state.resize.orig.handle === 'nw') {
      widthChange = -dx;
      heightChange = -dy;
    }

    if (!state.resize.orig.dominant) {
      state.resize.orig.dominant = Math.abs(widthChange) >= Math.abs(heightChange) ? 'width' : 'height';
    }

    let scale = 1;
    if (state.resize.orig.dominant === 'width') {
      scale = (state.resize.orig.imageWidth + widthChange) / state.resize.orig.imageWidth;
    } else {
      scale = (state.resize.orig.imageHeight + heightChange) / state.resize.orig.imageHeight;
    }

    // Prevent flipping or collapsing to zero, but no longer
    // force the image to fully cover the crop box – it may
    // be scaled smaller than the mask if the user zooms out.
    if (!Number.isFinite(scale) || scale <= 0) {
      scale = 0.01;
    }

    newImageWidth = state.resize.orig.imageWidth * scale;
    newImageHeight = state.resize.orig.imageHeight * scale;

    // Anchor the corner opposite to the dragged handle
    if (state.resize.orig.handle === 'se') {
      // anchor top-left: offsets unchanged
      newOffsetX = state.resize.orig.imageOffsetX;
      newOffsetY = state.resize.orig.imageOffsetY;
    } else if (state.resize.orig.handle === 'sw') {
      // anchor top-right
      const right = state.resize.orig.imageOffsetX + state.resize.orig.imageWidth;
      newOffsetX = right - newImageWidth;
      newOffsetY = state.resize.orig.imageOffsetY;
    } else if (state.resize.orig.handle === 'ne') {
      // anchor bottom-left
      const bottom = state.resize.orig.imageOffsetY + state.resize.orig.imageHeight;
      newOffsetX = state.resize.orig.imageOffsetX;
      newOffsetY = bottom - newImageHeight;
    } else if (state.resize.orig.handle === 'nw') {
      // anchor bottom-right
      const right = state.resize.orig.imageOffsetX + state.resize.orig.imageWidth;
      const bottom = state.resize.orig.imageOffsetY + state.resize.orig.imageHeight;
      newOffsetX = right - newImageWidth;
      newOffsetY = bottom - newImageHeight;
    }

    // Clamp offsets so the image stays positioned sensibly
    const minOffsetX = Math.min(0, photo.width - newImageWidth);
    const maxOffsetX = 0;
    const minOffsetY = Math.min(0, photo.height - newImageHeight);
    const maxOffsetY = 0;

    if (newOffsetX < minOffsetX) newOffsetX = minOffsetX;
    if (newOffsetX > maxOffsetX) newOffsetX = maxOffsetX;
    if (newOffsetY < minOffsetY) newOffsetY = minOffsetY;
    if (newOffsetY > maxOffsetY) newOffsetY = maxOffsetY;

    photo.imageWidth = newImageWidth;
    photo.imageHeight = newImageHeight;
    photo.imageOffsetX = newOffsetX;
    photo.imageOffsetY = newOffsetY;

    render();
  } else if (state.crop.active && state.crop.photoIdx === state.resize.photoIdx) {
    // Resize the crop mask (container) while the image stays
    // the same size underneath. In crop mode we use edge
    // handles (n, s, e, w) that move a single edge.
    const minSize = getMinPhotoSize(photo);
    let newWidth = state.resize.orig.width;
    let newHeight = state.resize.orig.height;
    let newX = state.resize.orig.x;
    let newY = state.resize.orig.y;

    const handle = state.resize.orig.handle;

    if (handle === 'e') {
      newWidth = state.resize.orig.width + dx;
    } else if (handle === 'w') {
      newWidth = state.resize.orig.width - dx;
      newX = state.resize.orig.x + dx;
    } else if (handle === 's') {
      newHeight = state.resize.orig.height + dy;
    } else if (handle === 'n') {
      newHeight = state.resize.orig.height - dy;
      newY = state.resize.orig.y + dy;
    }

    // If an aspect ratio is locked for the crop mask,
    // keep width/height in that ratio while the user
    // drags any of the mask handles. Horizontal drags
    // on side handles and vertical drags on top/bottom
    // handles are all that is needed; no diagonal drag
    // is required.
    if (state.crop.aspectMode) {
      let ratio = 1; // width / height
      if (state.crop.aspectMode === '4:3') {
        ratio = 4 / 3;
      } else if (state.crop.aspectMode === '3:4') {
        ratio = 3 / 4;
      } else if (state.crop.aspectMode === '1:1') {
        ratio = 1;
      }

      if (handle === 'e') {
        // Right edge: width driven by horizontal drag;
        // top-left corner remains anchored.
        newWidth = state.resize.orig.width + dx;
        newHeight = newWidth / ratio;
        newX = state.resize.orig.x;
        newY = state.resize.orig.y;
      } else if (handle === 'w') {
        // Left edge: width driven by horizontal drag;
        // top-right corner remains anchored.
        newWidth = state.resize.orig.width - dx;
        newHeight = newWidth / ratio;
        const right = state.resize.orig.x + state.resize.orig.width;
        newX = right - newWidth;
        newY = state.resize.orig.y;
      } else if (handle === 's') {
        // Bottom edge: height driven by vertical drag;
        // top-left corner remains anchored.
        newHeight = state.resize.orig.height + dy;
        newWidth = newHeight * ratio;
        newX = state.resize.orig.x;
        newY = state.resize.orig.y;
      } else if (handle === 'n') {
        // Top edge: height driven by vertical drag;
        // bottom-left corner remains anchored.
        newHeight = state.resize.orig.height - dy;
        newWidth = newHeight * ratio;
        const bottom = state.resize.orig.y + state.resize.orig.height;
        newY = bottom - newHeight;
        newX = state.resize.orig.x;
      }
    }

    if (newWidth < minSize.width) {
      const diff = minSize.width - newWidth;
      if (handle === 'w') {
        newX -= diff;
      }
      newWidth = minSize.width;
    }
    if (newHeight < minSize.height) {
      const diff = minSize.height - newHeight;
      if (handle === 'n') {
        newY -= diff;
      }
      newHeight = minSize.height;
    }

    // Keep the mask within the page bounds
    if (newX < 0) {
      newWidth += newX;
      newX = 0;
    }
    if (newY < 0) {
      newHeight += newY;
      newY = 0;
    }
    if (newX + newWidth > pageWidth) {
      newWidth = pageWidth - newX;
    }
    if (newY + newHeight > pageHeight) {
      newHeight = pageHeight - newY;
    }

    if (newWidth < minSize.width) newWidth = minSize.width;
    if (newHeight < minSize.height) newHeight = minSize.height;

    photo.width = newWidth;
    photo.height = newHeight;
    photo.x = newX;
    photo.y = newY;

    render();
  } else {
    // Normal resize: resize the bounding box and scale the
    // underlying image and any existing crop along with it.
    const minSize = getMinPhotoSize(photo);
    let newWidth = state.resize.orig.width;
    let newHeight = state.resize.orig.height;
    let newX = state.resize.orig.x;
    let newY = state.resize.orig.y;

    const aspect = state.resize.orig.width / state.resize.orig.height;
    const isCorner = ['nw', 'ne', 'se', 'sw'].includes(state.resize.orig.handle);

    if (isCorner) {
      let widthChange = 0;
      let heightChange = 0;

      if (state.resize.orig.handle === 'se') {
        widthChange = dx;
        heightChange = dy;
      } else if (state.resize.orig.handle === 'sw') {
        widthChange = -dx;
        heightChange = dy;
      } else if (state.resize.orig.handle === 'ne') {
        widthChange = dx;
        heightChange = -dy;
      } else if (state.resize.orig.handle === 'nw') {
        widthChange = -dx;
        heightChange = -dy;
      }

      if (!state.resize.orig.dominant) {
        state.resize.orig.dominant = Math.abs(widthChange) >= Math.abs(heightChange) ? 'width' : 'height';
      }

      if (state.resize.orig.dominant === 'width') {
        let targetWidth = state.resize.orig.width + widthChange;
        if (targetWidth < minSize.width) targetWidth = minSize.width;
        newWidth = targetWidth;
        newHeight = newWidth / aspect;
      } else {
        let targetHeight = state.resize.orig.height + heightChange;
        if (targetHeight < minSize.height) targetHeight = minSize.height;
        newHeight = targetHeight;
        newWidth = newHeight * aspect;
      }

      if (state.resize.orig.handle === 'sw' || state.resize.orig.handle === 'nw') {
        newX = state.resize.orig.x + (state.resize.orig.width - newWidth);
      }
      if (state.resize.orig.handle === 'nw' || state.resize.orig.handle === 'ne') {
        newY = state.resize.orig.y + (state.resize.orig.height - newHeight);
      }
    } else {
      if (state.resize.orig.handle === 'e') {
        newWidth = state.resize.orig.width + dx;
      } else if (state.resize.orig.handle === 'w') {
        newWidth = state.resize.orig.width - dx;
        newX = state.resize.orig.x + dx;
      } else if (state.resize.orig.handle === 's') {
        newHeight = state.resize.orig.height + dy;
      } else if (state.resize.orig.handle === 'n') {
        newHeight = state.resize.orig.height - dy;
        newY = state.resize.orig.y + dy;
      }

      if (newWidth < minSize.width) {
        const diff = minSize.width - newWidth;
        if (state.resize.orig.handle === 'w') {
          newX -= diff;
        }
        newWidth = minSize.width;
      }
      if (newHeight < minSize.height) {
        const diff = minSize.height - newHeight;
        if (state.resize.orig.handle === 'n') {
          newY -= diff;
        }
        newHeight = minSize.height;
      }
    }

    if (newX < 0) {
      newWidth += newX;
      newX = 0;
    }
    if (newY < 0) {
      newHeight += newY;
      newY = 0;
    }
    if (newX + newWidth > pageWidth) {
      newWidth = pageWidth - newX;
    }
    if (newY + newHeight > pageHeight) {
      newHeight = pageHeight - newY;
    }

    if (newWidth < minSize.width) newWidth = minSize.width;
    if (newHeight < minSize.height) newHeight = minSize.height;

    photo.width = newWidth;
    photo.height = newHeight;
    photo.x = newX;
    photo.y = newY;

    // Scale image and any existing crop with the box
    const scale = newWidth / state.resize.orig.width;
    photo.imageWidth = state.resize.orig.imageWidth * scale;
    photo.imageHeight = state.resize.orig.imageHeight * scale;
    photo.imageOffsetX = state.resize.orig.imageOffsetX * scale;
    photo.imageOffsetY = state.resize.orig.imageOffsetY * scale;

    render();
  }
}

// Use pointermove instead of separate mousemove/touchmove
document.addEventListener('pointermove', function(e) {
  handlePointerMove(e.pageX, e.pageY);
});

function handlePointerUp() {
  // Capture whether a drag/resize was actually active so we
  // only force a re-render when something was being adjusted.
  const hadInteraction = state.resize.active || state.drag.active || state.crop.draggingImage;

  // Release any captured pointer before resetting state
  if (state.pointer.activeId !== null && state.pointer.capturedElement && state.pointer.capturedElement.releasePointerCapture) {
    try {
      state.pointer.capturedElement.releasePointerCapture(state.pointer.activeId);
    } catch (err) {
      // Ignore if capture was already released.
    }
  }
  state.pointer.activeId = null;
  state.pointer.capturedElement = null;

  state.resize.active = false;
  state.resize.photoIdx = null;
  state.resize.start = null;
  state.resize.orig = null;
  state.drag.active = false;
  state.drag.photoIdx = null;
  state.drag.startPointer = null;
  state.drag.startPosition = null;
  state.crop.draggingImage = false;
  state.crop.imageDragStart = null;
  state.crop.imageOrigOffset = null;
  if (state.resize.handleElement) {
    state.resize.handleElement.classList.remove('handle-active');
    state.resize.handleElement = null;
  }

  // Only re-render when we were actually dragging/resizing.
  // This avoids destroying other controls between mouseup
  // and their click events (e.g. Add/Remove page buttons
  // or re-selecting a photo). Defer the render slightly so
  // any pending click handlers on photos can run first.
  if (hadInteraction) {
    setTimeout(() => render(), 0);
  }
}

// Use pointerup and pointercancel instead of separate mouse/touch events
document.addEventListener('pointerup', handlePointerUp);
document.addEventListener('pointercancel', handlePointerUp);

// Re-render on window resize to update responsive scaling
let resizeTimeout = null;
window.addEventListener('resize', function() {
  // Debounce resize events to avoid excessive re-renders
  if (resizeTimeout) clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    render();
  }, 100);
});

// Initialize global controls (static UI elements in HTML)
initGlobalControls();

// Initial render with sample photos on the first page
loadInitialSamplePhotos();
render();
