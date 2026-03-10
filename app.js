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
        imageOffsetY: 0
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
  mask.style.position = 'absolute';
  mask.style.left = '0';
  mask.style.top = '0';
  mask.style.right = '0';
  mask.style.bottom = '0';
  mask.style.overflow = 'hidden';

  const img = document.createElement('img');
  img.src = photo.src;
  img.className = 'photo';
  img.style.position = 'absolute';
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
  return mask;
}

// Create resize handles for the selected photo
function createResizeHandles(pageIndex, idx, photo, inCropMode, container) {
  const insetPx = CONTROL_INSET_PX + 'px';
  const handlePositions = inCropMode
    ? [
        { name: 's', left: '50%', bottom: insetPx, cursor: 'ns-resize', transform: 'translateX(-50%)' },
        { name: 'w', left: insetPx, top: '50%', cursor: 'ew-resize', transform: 'translateY(-50%)' },
        { name: 'e', right: insetPx, top: '50%', cursor: 'ew-resize', transform: 'translateY(-50%)' }
      ]
    : [
        { name: 'se', right: insetPx, bottom: insetPx, cursor: 'nwse-resize' }
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
    handle.className = handleClass;
    handle.style.position = 'absolute';
    if (pos.left) handle.style.left = pos.left;
    if (pos.right) handle.style.right = pos.right;
    if (pos.top) handle.style.top = pos.top;
    if (pos.bottom) handle.style.bottom = pos.bottom;
    if (pos.transform) handle.style.transform = pos.transform;
    handle.style.width = HANDLE_SIZE_PX + 'px';
    handle.style.height = HANDLE_SIZE_PX + 'px';
    handle.style.borderRadius = inCropMode ? '0' : '50%';
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
      icon.style.position = 'absolute';
      icon.style.left = '50%';
      icon.style.top = '50%';
      icon.style.transform = 'translate(-50%, -50%)';
      icon.style.width = '20px';
      icon.style.height = '20px';
      icon.style.pointerEvents = 'none';
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
        cropIconImg.style.position = 'absolute';
        cropIconImg.style.left = '50%';
        cropIconImg.style.top = '50%';
        cropIconImg.style.transform = 'translate(-50%, -50%)';
        cropIconImg.style.width = '20px';
        cropIconImg.style.height = '20px';
        cropIconImg.style.pointerEvents = 'none';
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
  imageFrame.style.position = 'absolute';
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
  imgHandle.className = imgHandleClass;
  imgHandle.style.position = 'absolute';
  imgHandle.style.right = CONTROL_INSET_PX + 'px';
  imgHandle.style.bottom = CONTROL_INSET_PX + 'px';
  imgHandle.style.width = HANDLE_SIZE_PX + 'px';
  imgHandle.style.height = HANDLE_SIZE_PX + 'px';
  imgHandle.style.borderRadius = '50%';
  imgHandle.style.cursor = 'nwse-resize';
  imgHandle.setAttribute('data-handle', 'se');

  imgHandle.onpointerdown = e => {
    state.document.currentPage = pageIndex;
    startImageResize(e, idx, 'se');
  };

  const handleIcon = document.createElement('img');
  handleIcon.src = 'icons/arrow-top-left-bottom-right.svg';
  handleIcon.alt = 'Resize image';
  handleIcon.style.position = 'absolute';
  handleIcon.style.left = '50%';
  handleIcon.style.top = '50%';
  handleIcon.style.transform = 'translate(-50%, -50%)';
  handleIcon.style.width = '20px';
  handleIcon.style.height = '20px';
  handleIcon.style.pointerEvents = 'none';
  imgHandle.appendChild(handleIcon);

  applyCounterScale(imgHandle, 'bottom right');
  imageFrame.appendChild(imgHandle);
  container.appendChild(imageFrame);
}

// Create photo control buttons (rotate, crop, ratio presets, delete)
function createPhotoControls(pageIndex, idx, inCropMode, container) {
  const insetPx = CONTROL_INSET_PX + 'px';

  // Rotate button
  const rotateButton = document.createElement('div');
  rotateButton.className = 'resize-handle image-resize-handle icon-btn icon-btn--md';
  rotateButton.setAttribute('data-html2canvas-ignore', 'true');
  rotateButton.style.left = insetPx;
  rotateButton.style.top = insetPx;
  rotateButton.onclick = e => {
    e.stopPropagation();
    state.document.currentPage = pageIndex;
    rotatePhoto(idx);
  };

  const rotateIcon = document.createElement('img');
  rotateIcon.src = 'icons/file-rotate-right.svg';
  rotateIcon.alt = 'Rotate';
  rotateIcon.className = 'icon-btn__icon icon-btn__icon--md';
  rotateButton.appendChild(rotateIcon);
  applyCounterScale(rotateButton, 'top left');
  container.appendChild(rotateButton);

  // Crop button
  const cropButton = document.createElement('div');
  cropButton.className = 'resize-handle image-resize-handle icon-btn icon-btn--md crop-toggle';
  cropButton.setAttribute('data-html2canvas-ignore', 'true');
  // Position to the right of rotate button (button width 40px + inset)
  cropButton.style.left = (BUTTON_SIZE_LG_PX + CONTROL_INSET_PX) + 'px';
  cropButton.style.top = insetPx;
  cropButton.onclick = e => {
    e.stopPropagation();
    state.document.currentPage = pageIndex;
    toggleCrop(idx);
  };

  const cropIcon = document.createElement('img');
  cropIcon.src = 'icons/crop.svg';
  cropIcon.alt = 'Crop';
  cropIcon.className = 'icon-btn__icon icon-btn__icon--md';
  cropButton.appendChild(cropIcon);
  applyCounterScale(cropButton, 'top left');
  container.appendChild(cropButton);

  // Aspect-ratio preset buttons (only in crop mode)
  if (inCropMode) {
    // Calculate button offsets: each button is 40px wide with 4px spacing
    const buttonSpacing = BUTTON_SIZE_LG_PX + CONTROL_INSET_PX;
    const ratioButtons = [
      { mode: '4:3', icon: 'icons/crop-landscape.svg', offset: buttonSpacing * 2 },
      { mode: '3:4', icon: 'icons/crop-portrait.svg', offset: buttonSpacing * 3 },
      { mode: '1:1', icon: 'icons/crop-square.svg', offset: buttonSpacing * 4 }
    ];

    ratioButtons.forEach(cfg => {
      const btn = document.createElement('div');
      let classNames = 'resize-handle image-resize-handle icon-btn icon-btn--md crop-ratio-toggle';
      if (state.crop.aspectMode === cfg.mode) classNames += ' crop-ratio-active';
      btn.className = classNames;
      btn.setAttribute('data-html2canvas-ignore', 'true');
      btn.style.left = cfg.offset + 'px';
      btn.style.top = insetPx;

      btn.onclick = e => {
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
      };

      const iconEl = document.createElement('img');
      iconEl.src = cfg.icon;
      iconEl.alt = cfg.mode === '4:3'
        ? 'Crop 4:3 landscape'
        : cfg.mode === '3:4'
        ? 'Crop 3:4 portrait'
        : 'Crop 1:1 square';
      iconEl.className = 'icon-btn__icon icon-btn__icon--md';
      btn.appendChild(iconEl);
      applyCounterScale(btn, 'top left');
      container.appendChild(btn);
    });
  }

  // Delete button
  const deleteButton = document.createElement('div');
  deleteButton.className = 'resize-handle image-resize-handle icon-btn icon-btn--md';
  deleteButton.setAttribute('data-html2canvas-ignore', 'true');
  deleteButton.style.left = insetPx;
  deleteButton.style.bottom = insetPx;
  deleteButton.onclick = e => {
    e.stopPropagation();
    state.document.currentPage = pageIndex;
    deletePhoto(pageIndex, idx);
  };

  const deleteIcon = document.createElement('img');
  deleteIcon.src = 'icons/delete-outline.svg';
  deleteIcon.alt = 'Delete photo';
  deleteIcon.className = 'icon-btn__icon icon-btn__icon--md';
  deleteButton.appendChild(deleteIcon);
  applyCounterScale(deleteButton, 'bottom left');
  container.appendChild(deleteButton);
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
  info.style.position = 'absolute';
  info.style.right = CONTROL_INSET_PX + 'px';
  info.style.top = CONTROL_INSET_PX + 'px';
  info.style.fontSize = '11px';
  info.style.lineHeight = '1.2';
  info.style.color = '#333';
  info.style.background = 'rgba(255, 255, 255, 0.9)';
  info.style.padding = '2px 4px';
  info.style.borderRadius = '3px';
  info.style.whiteSpace = 'nowrap';
  info.style.pointerEvents = 'none';

  const aspectLine = document.createElement('div');
  aspectLine.textContent = arW + ' : ' + arH;

  const widthLine = document.createElement('div');
  widthLine.style.display = 'flex';
  widthLine.style.alignItems = 'center';
  const widthIcon = document.createElement('img');
  widthIcon.src = 'icons/arrow-expand-horizontal.svg';
  widthIcon.alt = 'Width';
  widthIcon.style.width = '14px';
  widthIcon.style.height = '14px';
  widthIcon.style.marginRight = '4px';
  widthIcon.style.pointerEvents = 'none';
  const widthText = document.createElement('span');
  widthText.textContent = mmWidth.toFixed(1) + ' mm';
  widthLine.appendChild(widthIcon);
  widthLine.appendChild(widthText);

  const heightLine = document.createElement('div');
  heightLine.style.display = 'flex';
  heightLine.style.alignItems = 'center';
  const heightIcon = document.createElement('img');
  heightIcon.src = 'icons/arrow-expand-vertical.svg';
  heightIcon.alt = 'Height';
  heightIcon.style.width = '14px';
  heightIcon.style.height = '14px';
  heightIcon.style.marginRight = '4px';
  heightIcon.style.pointerEvents = 'none';
  const heightText = document.createElement('span');
  heightText.textContent = mmHeight.toFixed(1) + ' mm';
  heightLine.appendChild(heightIcon);
  heightLine.appendChild(heightText);

  info.appendChild(aspectLine);
  info.appendChild(widthLine);
  info.appendChild(heightLine);
  applyCounterScale(info, 'right top');
  container.appendChild(info);
}

// Create Add Page and Delete Page buttons below the active page
function createPageActions(pageWidthPx, scale) {
  const actions = document.createElement('div');
  actions.className = 'page-actions';
  actions.style.position = 'relative';
  actions.style.width = (pageWidthPx * scale) + 'px';
  actions.style.height = BUTTON_SIZE_LG_PX + 'px';
  actions.style.margin = '8px auto 24px auto';

  // Add Page button (centred)
  const addButton = document.createElement('div');
  addButton.className = 'resize-handle image-resize-handle icon-btn icon-btn--lg page-add-button';
  addButton.style.left = '50%';
  addButton.style.top = '0';
  addButton.style.transform = 'translateX(-50%)';
  addButton.onclick = e => {
    e.stopPropagation();
    window.addPage();
  };

  const plusIcon = document.createElement('img');
  plusIcon.src = 'icons/plus.svg';
  plusIcon.alt = 'Add page';
  plusIcon.className = 'icon-btn__icon icon-btn__icon--lg';
  addButton.appendChild(plusIcon);
  actions.appendChild(addButton);

  // Delete Page button (left-aligned), hidden if only one page
  if (state.document.pages.length > 1) {
    const deletePageButton = document.createElement('div');
    deletePageButton.className = 'resize-handle image-resize-handle icon-btn icon-btn--lg page-delete-button';
    deletePageButton.style.left = '0';
    deletePageButton.style.top = '0';
    deletePageButton.onclick = e => {
      e.stopPropagation();
      window.removePage();
    };

    const deleteIcon = document.createElement('img');
    deleteIcon.src = 'icons/file-remove-outline.svg';
    deleteIcon.alt = 'Delete page';
    deleteIcon.className = 'icon-btn__icon icon-btn__icon--lg';
    deletePageButton.appendChild(deleteIcon);
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
      const addImageButton = document.createElement('div');
      addImageButton.className = 'resize-handle image-resize-handle icon-btn icon-btn--lg page-add-image-button';
      addImageButton.setAttribute('data-html2canvas-ignore', 'true');
      // Position to the left of the page edge
      addImageButton.style.left = '-' + ADD_IMAGE_BUTTON_OFFSET_PX + 'px';
      addImageButton.style.top = '0';
      addImageButton.onclick = e => {
        e.stopPropagation();
        const input = document.getElementById('photo-file-input');
        if (input) {
          input.click();
        }
      };

      const plusImg = document.createElement('img');
      plusImg.src = 'icons/image-plus.svg';
      plusImg.alt = 'Add image';
      plusImg.className = 'icon-btn__icon icon-btn__icon--lg';

      addImageButton.appendChild(plusImg);
      // Counter-scale so button stays at original size; anchor
      // at right edge so it grows leftward away from the page.
      applyCounterScale(addImageButton, 'right center');
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

  if (targetWidth < MIN_PHOTO_SIZE_PX || targetHeight < MIN_PHOTO_SIZE_PX) {
    const upScale = Math.max(MIN_PHOTO_SIZE_PX / targetWidth, MIN_PHOTO_SIZE_PX / targetHeight);
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
        imageOffsetY: 0
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

    if (newWidth < MIN_PHOTO_SIZE_PX) {
      const diff = MIN_PHOTO_SIZE_PX - newWidth;
      if (handle === 'w') {
        newX -= diff;
      }
      newWidth = MIN_PHOTO_SIZE_PX;
    }
    if (newHeight < MIN_PHOTO_SIZE_PX) {
      const diff = MIN_PHOTO_SIZE_PX - newHeight;
      if (handle === 'n') {
        newY -= diff;
      }
      newHeight = MIN_PHOTO_SIZE_PX;
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

    if (newWidth < MIN_PHOTO_SIZE_PX) newWidth = MIN_PHOTO_SIZE_PX;
    if (newHeight < MIN_PHOTO_SIZE_PX) newHeight = MIN_PHOTO_SIZE_PX;

    photo.width = newWidth;
    photo.height = newHeight;
    photo.x = newX;
    photo.y = newY;

    render();
  } else {
    // Normal resize: resize the bounding box and scale the
    // underlying image and any existing crop along with it.
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
        if (targetWidth < MIN_PHOTO_SIZE_PX) targetWidth = MIN_PHOTO_SIZE_PX;
        newWidth = targetWidth;
        newHeight = newWidth / aspect;
      } else {
        let targetHeight = state.resize.orig.height + heightChange;
        if (targetHeight < MIN_PHOTO_SIZE_PX) targetHeight = MIN_PHOTO_SIZE_PX;
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

      if (newWidth < MIN_PHOTO_SIZE_PX) {
        const diff = MIN_PHOTO_SIZE_PX - newWidth;
        if (state.resize.orig.handle === 'w') {
          newX -= diff;
        }
        newWidth = MIN_PHOTO_SIZE_PX;
      }
      if (newHeight < MIN_PHOTO_SIZE_PX) {
        const diff = MIN_PHOTO_SIZE_PX - newHeight;
        if (state.resize.orig.handle === 'n') {
          newY -= diff;
        }
        newHeight = MIN_PHOTO_SIZE_PX;
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

    if (newWidth < MIN_PHOTO_SIZE_PX) newWidth = MIN_PHOTO_SIZE_PX;
    if (newHeight < MIN_PHOTO_SIZE_PX) newHeight = MIN_PHOTO_SIZE_PX;

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
