// Photo Collage Printer - app.js
// Main entry point for the web-app

const app = document.getElementById('app');

// State
let pages = [{
  size: { width: 210, height: 297 }, // A4 in mm
  photos: []
}];
let currentPage = 0;

// Selection state
let selectedPhoto = null;

// Drag state (moving the photo container on the page)
let dragIdx = null;
let dragStart = null;      // initial pointer position {x, y}
let dragPhotoStart = null; // initial photo position {x, y}
let dragging = false;

// Resize state (handles on the bounding box / crop mask)
let resizing = false;
let resizeStart = null;
let resizePhotoIdx = null;
let resizeOrig = null;
let activeHandleElement = null;

// Pointer capture state for reliable touch/pen tracking
let activePointerId = null;
let capturedElement = null;

// Crop state
let cropMode = false;        // whether crop mode is active
let cropPhotoIdx = null;     // which photo is in crop mode

// Optional aspect-ratio lock for the crop mask while in
// crop mode. When non-null, the crop box is constrained
// to this ratio during mask-resize operations.
// Values: '4:3' | '3:4' | '1:1'
let cropAspectMode = null;

// When in crop mode, dragging the image (not the mask) moves
// the image underneath a stationary crop mask.
let cropDragImage = false;
let cropImageDragStart = null;
let cropImageOrigOffset = null;

// Settings UI state
let settingsOpen = false;
let helpOpen = false;

// Responsive scaling: tracks the current scale factor applied
// to collage pages so coordinate calculations can compensate.
let currentPageScale = 1;

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
  if (currentPageScale >= 1) return;
  const counterScale = 1 / currentPageScale;
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
  const page = pages[0];
  if (!page || page.photos.length > 0) return;

  const pxPerMm = 3;

  SAMPLE_PHOTO_LAYOUT.forEach(config => {
    const img = new Image();
    img.onload = function() {
      const naturalW = img.naturalWidth || img.width || 1;
      const naturalH = img.naturalHeight || img.height || 1;

      let widthPx;
      let heightPx;
      if (config.widthMm) {
        widthPx = config.widthMm * pxPerMm;
        heightPx = widthPx * (naturalH / naturalW);
      } else if (config.heightMm) {
        heightPx = config.heightMm * pxPerMm;
        widthPx = heightPx * (naturalW / naturalH);
      } else {
        // Fallback: use 45% of page width.
        const pageWidthPx = page.size.width * pxPerMm;
        widthPx = pageWidthPx * 0.45;
        const scale = widthPx / naturalW;
        heightPx = naturalH * scale;
      }

      const xPx = (config.xMm != null ? config.xMm * pxPerMm : 10);
      const yPx = (config.yMm != null ? config.yMm * pxPerMm : 10);

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
        selectedPhoto = page.photos.length - 1;
      }

      // Apply any initial quarter-turn rotations declared
      // in the layout. This uses the existing rotatePhoto
      // helper (subject to the same file:// security rules).
      const turns = config.rotationTurns || 0;
      if (turns > 0) {
        const originalPage = currentPage;
        currentPage = 0;
        const photoIndex = page.photos.length - 1;
        for (let i = 0; i < turns; i++) {
          rotatePhoto(photoIndex);
        }
        currentPage = originalPage;
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
  renderPageControls();
  renderPhotoControls();
  renderCollagePage();

  // Restore scroll position after DOM is rebuilt
  window.scrollTo(scrollX, scrollY);
}

function renderPageControls() {
  const div = document.createElement('div');
  div.className = 'page-controls';
  // App heading and subheading: explain the main goal of
  // filling each sheet to avoid wasting paper.
  const title = document.createElement('div');
  title.className = 'app-title';
  title.textContent = 'Photo Collage Printer';

  const subtitle = document.createElement('div');
  subtitle.className = 'app-subtitle';
  subtitle.textContent = 'Fill the page, save the paper';

  const description = document.createElement('div');
  description.className = 'app-description';
  description.textContent = 'Add, move, crop, and size your happy snaps so every print uses the whole sheet.';

  div.appendChild(title);
  div.appendChild(subtitle);
   div.appendChild(description);

  // Page actions themselves are attached directly to each
  // page below; this header is purely informational.
  app.appendChild(div);
}

function renderPhotoControls() {
  const div = document.createElement('div');
  div.className = 'photo-controls';
  div.innerHTML = `
    <input id="photo-file-input" type="file" accept="image/*" onchange="importPhoto(event)" style="display:none">
  `;
  app.appendChild(div);

  // Global Print button: circular icon in the upper-right
  // corner of the app container, with a small inset.
  const printButton = document.createElement('div');
  printButton.className = 'resize-handle image-resize-handle icon-btn icon-btn--lg app-print-button';
  printButton.setAttribute('data-html2canvas-ignore', 'true');
  // 8px breathing room to the top/right of the button
  printButton.style.top = '8px';
  printButton.style.right = '8px';
  printButton.onclick = e => {
    e.stopPropagation();
    window.printCollage();
  };

  const printIcon = document.createElement('img');
  printIcon.src = 'icons/printer-outline.svg';
  printIcon.alt = 'Print collage';
  printIcon.className = 'icon-btn__icon icon-btn__icon--lg';

  printButton.appendChild(printIcon);
  app.appendChild(printButton);

  // Settings button: cog icon below the print button.
  const settingsButton = document.createElement('div');
  settingsButton.className = 'resize-handle image-resize-handle icon-btn icon-btn--lg app-settings-button';
  settingsButton.setAttribute('data-html2canvas-ignore', 'true');
  // 8px from right, placed below the print button with
  // an 8px vertical gap (8 + 40 + 8 = 56).
  settingsButton.style.top = '56px';
  settingsButton.style.right = '8px';
  settingsButton.onclick = e => {
    e.stopPropagation();
    settingsOpen = !settingsOpen;
    render();
  };

  const settingsIcon = document.createElement('img');
  settingsIcon.src = 'icons/cog-outline.svg';
  settingsIcon.alt = 'Settings';
  settingsIcon.className = 'icon-btn__icon icon-btn__icon--lg';

  settingsButton.appendChild(settingsIcon);
  app.appendChild(settingsButton);

  // GitHub button: link to the project repository,
  // stacked below the settings button.
  const githubButton = document.createElement('div');
  githubButton.className = 'resize-handle image-resize-handle icon-btn icon-btn--lg app-github-button';
  githubButton.setAttribute('data-html2canvas-ignore', 'true');
  // 8px gap below the 40px-tall settings button
  githubButton.style.top = '104px';
  githubButton.style.right = '8px';
  githubButton.onclick = e => {
    e.stopPropagation();
    window.open('https://github.com/dj-louw/photo-collage-printer', '_blank');
  };

  const githubIcon = document.createElement('img');
  githubIcon.src = 'icons/github.svg';
  githubIcon.alt = 'Open GitHub repository';
  githubIcon.className = 'icon-btn__icon icon-btn__icon--lg';

  githubButton.appendChild(githubIcon);
  app.appendChild(githubButton);

  // Help button: stacked below the GitHub button.
  const helpButton = document.createElement('div');
  helpButton.className = 'resize-handle image-resize-handle icon-btn icon-btn--lg app-help-button';
  helpButton.setAttribute('data-html2canvas-ignore', 'true');
  // 8px gap below the 40px-tall GitHub button
  helpButton.style.top = '152px';
  helpButton.style.right = '8px';
  helpButton.onclick = e => {
    e.stopPropagation();
    helpOpen = true;
    render();
  };

  const helpIcon = document.createElement('img');
  helpIcon.src = 'icons/help.svg';
  helpIcon.alt = 'Help';
  helpIcon.className = 'icon-btn__icon icon-btn__icon--lg';

  helpButton.appendChild(helpIcon);
  app.appendChild(helpButton);

  // Settings fly-out menu: currently only page size.
  if (settingsOpen) {
    const page = pages[currentPage];
    const isLetter = page.size.width === 216 && page.size.height === 279;
    const currentSizeValue = isLetter ? 'Letter' : 'A4';

    const flyout = document.createElement('div');
    flyout.className = 'flyout settings-flyout';
    // Align the flyout with the top of the settings
    // button and place it to the left of the button
    // column, inside the app container.
    flyout.style.top = '56px';
    flyout.style.right = '56px';

    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'flyout__title settings-section-title';
    sectionTitle.textContent = 'Page size';
    flyout.appendChild(sectionTitle);

    const sizes = [
      { value: 'A4', label: 'A4' },
      { value: 'Letter', label: 'Letter' }
    ];

    sizes.forEach(size => {
      const row = document.createElement('div');
      row.className = 'flyout__row settings-option' + (currentSizeValue === size.value ? ' active' : '');
      if (currentSizeValue === size.value) {
        row.style.fontWeight = 'bold';
        row.style.background = '#e0f2ff';
      }
      row.onclick = e => {
        e.stopPropagation();
        window.changePageSize(size.value);
        settingsOpen = false;
      };
      row.textContent = size.label;
      flyout.appendChild(row);
    });

    app.appendChild(flyout);
  }

  // Help modal overlay
  if (helpOpen) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay help-overlay';
    overlay.setAttribute('data-html2canvas-ignore', 'true');
    overlay.onclick = () => {
      helpOpen = false;
      render();
    };

    const modal = document.createElement('div');
    modal.className = 'modal help-modal';
    modal.onclick = e => e.stopPropagation();

    const title = document.createElement('div');
    title.className = 'modal__title';
    title.textContent = 'How to use Photo Collage Printer';
    modal.appendChild(title);

    const sections = document.createElement('div');
    sections.className = 'modal__content';

    const mkRow = (iconSrc, alt, text) => {
      const row = document.createElement('div');
      row.className = 'modal__row';

      const btn = document.createElement('div');
      btn.className = 'resize-handle image-resize-handle icon-btn--sm modal__row-icon';

      const ic = document.createElement('img');
      ic.src = iconSrc;
      ic.alt = alt;
      ic.className = 'icon-btn__icon icon-btn__icon--sm';

      btn.appendChild(ic);

      const span = document.createElement('span');
      span.textContent = text;

      row.appendChild(btn);
      row.appendChild(span);
      return row;
    };

    // Top-level actions
    sections.appendChild(mkRow('icons/image-plus.svg', 'Add image', 'Add a new image to the active page.'));
    sections.appendChild(mkRow('icons/plus.svg', 'Add page', 'Add a new blank page below the current one.'));
    sections.appendChild(mkRow('icons/file-remove-outline.svg', 'Delete', 'Delete the active page.'));
    sections.appendChild(mkRow('icons/delete-outline.svg', 'Delete', 'Delete the selected photo.'));

    const sep1 = document.createElement('div');
    sep1.className = 'modal__separator';
    modal.appendChild(sep1);

    sections.appendChild(mkRow('icons/file-rotate-right.svg', 'Rotate photo', 'Rotate the selected photo 90° clockwise.'));
    sections.appendChild(mkRow('icons/crop.svg', 'Crop mode', 'Toggle crop mode to adjust the visible part of a photo.'));
    sections.appendChild(mkRow('icons/arrow-top-left-bottom-right.svg', 'Resize / zoom', 'Drag resize handles to resize photos or zoom while cropping.'));

    const sep2 = document.createElement('div');
    sep2.className = 'modal__separator';
    modal.appendChild(sep2);

    sections.appendChild(mkRow('icons/cog-outline.svg', 'Page size', 'Open settings to switch between A4 and Letter.'));
    sections.appendChild(mkRow('icons/printer-outline.svg', 'Print / PDF', 'Export all pages to a printable PDF.'));
    sections.appendChild(mkRow('icons/github.svg', 'GitHub', 'Open the project on GitHub.'));

    modal.appendChild(sections);

    // Icon-style close button in the top-right corner,
    // using the same round button style as other controls.
    const closeBtn = document.createElement('div');
    closeBtn.className = 'resize-handle image-resize-handle icon-btn icon-btn--sm help-close-button';
    closeBtn.style.top = '8px';
    closeBtn.style.right = '8px';
    closeBtn.onclick = e => {
      e.stopPropagation();
      helpOpen = false;
      render();
    };

    const closeIcon = document.createElement('img');
    closeIcon.src = 'icons/close.svg';
    closeIcon.alt = 'Close help';
    closeIcon.className = 'icon-btn__icon icon-btn__icon--sm';

    closeBtn.appendChild(closeIcon);
    modal.appendChild(closeBtn);

    overlay.appendChild(modal);
    // Attach to the app container so the overlay is
    // cleared automatically on each render.
    app.appendChild(overlay);
  }
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
  const handlePositions = inCropMode
    ? [
        { name: 's', left: '50%', bottom: '4px', cursor: 'ns-resize', transform: 'translateX(-50%)' },
        { name: 'w', left: '4px', top: '50%', cursor: 'ew-resize', transform: 'translateY(-50%)' },
        { name: 'e', right: '4px', top: '50%', cursor: 'ew-resize', transform: 'translateY(-50%)' }
      ]
    : [
        { name: 'se', right: '4px', bottom: '4px', cursor: 'nwse-resize' }
      ];

  handlePositions.forEach(pos => {
    const handle = document.createElement('div');
    let handleClass = 'resize-handle image-resize-handle';
    if (
      resizing &&
      resizePhotoIdx === idx &&
      resizeOrig &&
      resizeOrig.kind === 'box' &&
      resizeOrig.handle === pos.name
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
    handle.style.width = '32px';
    handle.style.height = '32px';
    handle.style.borderRadius = inCropMode ? '0' : '50%';
    handle.style.cursor = pos.cursor;
    handle.setAttribute('data-handle', pos.name);

    handle.onpointerdown = e => {
      currentPage = pageIndex;
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
    resizing &&
    resizePhotoIdx === idx &&
    resizeOrig &&
    resizeOrig.kind === 'image' &&
    resizeOrig.handle === 'se'
  ) {
    imgHandleClass += ' handle-active';
  }
  imgHandle.className = imgHandleClass;
  imgHandle.style.position = 'absolute';
  imgHandle.style.right = '4px';
  imgHandle.style.bottom = '4px';
  imgHandle.style.width = '32px';
  imgHandle.style.height = '32px';
  imgHandle.style.borderRadius = '50%';
  imgHandle.style.cursor = 'nwse-resize';
  imgHandle.setAttribute('data-handle', 'se');

  imgHandle.onpointerdown = e => {
    currentPage = pageIndex;
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
  // Rotate button
  const rotateButton = document.createElement('div');
  rotateButton.className = 'resize-handle image-resize-handle icon-btn icon-btn--md';
  rotateButton.setAttribute('data-html2canvas-ignore', 'true');
  rotateButton.style.left = '4px';
  rotateButton.style.top = '4px';
  rotateButton.onclick = e => {
    e.stopPropagation();
    currentPage = pageIndex;
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
  cropButton.style.left = '44px';
  cropButton.style.top = '4px';
  cropButton.onclick = e => {
    e.stopPropagation();
    currentPage = pageIndex;
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
    const ratioButtons = [
      { mode: '4:3', icon: 'icons/crop-landscape.svg', offset: 84 },
      { mode: '3:4', icon: 'icons/crop-portrait.svg', offset: 124 },
      { mode: '1:1', icon: 'icons/crop-square.svg', offset: 164 }
    ];

    ratioButtons.forEach(cfg => {
      const btn = document.createElement('div');
      let classNames = 'resize-handle image-resize-handle icon-btn icon-btn--md crop-ratio-toggle';
      if (cropAspectMode === cfg.mode) classNames += ' crop-ratio-active';
      btn.className = classNames;
      btn.setAttribute('data-html2canvas-ignore', 'true');
      btn.style.left = cfg.offset + 'px';
      btn.style.top = '4px';

      btn.onclick = e => {
        e.stopPropagation();
        currentPage = pageIndex;

        const pageForAspect = pages[currentPage];
        const photoForAspect = pageForAspect.photos[idx];

        if (cropAspectMode === cfg.mode) {
          cropAspectMode = null;
        } else {
          cropAspectMode = cfg.mode;
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
  deleteButton.style.left = '4px';
  deleteButton.style.bottom = '4px';
  deleteButton.onclick = e => {
    e.stopPropagation();
    currentPage = pageIndex;
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
  const mmWidth = wPx / 3;
  const mmHeight = hPx / 3;

  const info = document.createElement('div');
  info.className = 'photo-size-info';
  info.setAttribute('data-html2canvas-ignore', 'true');
  info.style.position = 'absolute';
  info.style.right = '4px';
  info.style.top = '4px';
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
  actions.style.height = '40px';
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
  if (pages.length > 1) {
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
  pages.forEach((page, pageIndex) => {
    const div = document.createElement('div');
    const pageClasses = ['collage-page'];
    if (pageIndex === currentPage) {
      pageClasses.push('active-page');
    }
    div.className = pageClasses.join(' ');
    const pageWidthPx = page.size.width * 3;
    const pageHeightPx = page.size.height * 3;
    div.style.width = pageWidthPx + 'px';
    div.style.height = pageHeightPx + 'px';
    div.dataset.pageIndex = String(pageIndex);

    // Clicking on empty space on a page clears any
    // current selection/crop and makes that page the
    // active one for subsequent operations.
    div.addEventListener('click', e => {
      const photoContainer = e.target.closest('.photo-container');
      if (!photoContainer) {
        currentPage = pageIndex;
        selectedPhoto = null;
        cropMode = false;
        cropPhotoIdx = null;
        render();
      }
    });

    // For the active page, show an Add Image button attached
    // to the left edge at the top, using the same plus icon
    // as Add Page. It triggers the hidden file input.
    if (pageIndex === currentPage) {
      const addImageButton = document.createElement('div');
      addImageButton.className = 'resize-handle image-resize-handle icon-btn icon-btn--lg page-add-image-button';
      addImageButton.setAttribute('data-html2canvas-ignore', 'true');
      // 40px button width + 32px gap => 72px offset
      addImageButton.style.left = '-72px';
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
    const isOnActivePage = pageIndex === currentPage;
    const isSelectedOnActivePage = isOnActivePage && selectedPhoto === idx;
    if (isSelectedOnActivePage) classes.push('selected');
    if (cropMode && isOnActivePage && cropPhotoIdx === idx) classes.push('cropping-active');
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
      const inCropMode = cropMode && cropPhotoIdx === idx;

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
  currentPageScale = scale;
  
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
  if (pageIndex === currentPage) {
    const actions = createPageActions(pageWidthPx, scale);
    app.appendChild(actions);
  }
  });
}

// Page controls
window.addPage = function() {
  pages.push({ size: { width: 210, height: 297 }, photos: [] });
  currentPage = pages.length - 1;
  render();
};

window.removePage = function() {
  if (pages.length > 1) {
    pages.splice(currentPage, 1);
    currentPage = Math.max(0, currentPage - 1);
    selectedPhoto = null;
    render();
  }
};

window.changePageSize = function(size) {
  const sizes = {
    'A4': { width: 210, height: 297 },
    'Letter': { width: 216, height: 279 }
  };
  pages[currentPage].size = sizes[size];
  render();
};

// Apply an aspect-ratio preset to the current crop box.
// This adjusts the box dimensions immediately when a
// ratio button is clicked, before enforcing it during
// subsequent resize operations.
function applyCropAspectPreset(photo, page, mode) {
  if (!photo || !page) return;

  const pxPerMm = 3;
  let desiredWidth = photo.width;
  let desiredHeight = photo.height;

  if (mode === '4:3') {
    // Landscape: 150mm × 100mm
    desiredWidth = 150 * pxPerMm;  // 150mm wide
    desiredHeight = 100 * pxPerMm; // 100mm tall
  } else if (mode === '3:4') {
    // Portrait: 100mm × 150mm
    desiredWidth = 100 * pxPerMm;  // 100mm wide
    desiredHeight = 150 * pxPerMm; // 150mm tall
  } else if (mode === '1:1') {
    // Square: keep roughly the current box size but enforce 1:1.
    const side = Math.min(photo.width, photo.height);
    desiredWidth = side;
    desiredHeight = side;
  }

  if (desiredWidth <= 0 || desiredHeight <= 0) return;

  const pageWidth = page.size.width * pxPerMm;
  const pageHeight = page.size.height * pxPerMm;

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

  const minSize = 20;
  if (targetWidth < minSize || targetHeight < minSize) {
    const upScale = Math.max(minSize / targetWidth, minSize / targetHeight);
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
  const page = pages[pageIndex];
  if (!page) return;
  if (idx < 0 || idx >= page.photos.length) return;

  page.photos.splice(idx, 1);

  if (pageIndex === currentPage) {
    selectedPhoto = null;
    cropMode = false;
    cropPhotoIdx = null;
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
      const page = pages[currentPage];
      const pageWidthPx = page.size.width * 3;
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
      selectedPhoto = page.photos.length - 1;
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
  const pageSize = pages[0].size;
  const isLetter = pageSize.width === 216 && pageSize.height === 279;
  const pdfFormat = isLetter ? 'letter' : 'a4';
  const pdf = new jsPDF('portrait', 'mm', pdfFormat);
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  let firstPage = true;
  for (let i = 0; i < pageEls.length; i++) {
    const pageEl = pageEls[i];
    // Render each collage page to a high-resolution canvas
    const canvas = await window.html2canvas(pageEl, { scale: 2 });
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
  currentPage = pageIndex;
  selectedPhoto = idx;
  // Leaving crop mode when switching selection keeps
  // the interaction model simple across pages.
  cropMode = false;
  cropPhotoIdx = null;
  render();
}
function toggleCrop(idx) {
  // Toggle crop mode for a given photo. Crops are non-destructive:
  // we never alter the underlying photo.src, only how it is shown
  // inside its bounding box via imageWidth/Height and offsets.
  if (cropMode && cropPhotoIdx === idx) {
    // Turning crop mode off for the same photo simply exits the
    // editing experience; the current mask stays in effect.
    cropMode = false;
    cropPhotoIdx = null;
    render();
    return;
  }

  // Switch crop focus to another photo (no commit step required).
  cropMode = true;
  cropPhotoIdx = idx;
  selectedPhoto = idx;
  render();
}

// Rotate photo by 90 degrees clockwise by redrawing the bitmap.
// This avoids CSS transform artefacts like letterboxing/cropping
// because the underlying image data itself is rotated.
function rotatePhoto(idx) {
  const page = pages[currentPage];
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

    const pageWidth = page.size.width * 3;
    const pageHeight = page.size.height * 3;

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
  if (activeHandleElement && activeHandleElement !== e.currentTarget) {
    activeHandleElement.classList.remove('handle-active');
  }
  activeHandleElement = e.currentTarget || e.target;
  if (activeHandleElement) {
    activeHandleElement.classList.add('handle-active');
  }
  // Capture the pointer for reliable tracking during resize
  if (e.pointerId !== undefined && activeHandleElement && activeHandleElement.setPointerCapture) {
    try {
      activeHandleElement.setPointerCapture(e.pointerId);
      activePointerId = e.pointerId;
      capturedElement = activeHandleElement;
    } catch (err) {
      // Pointer capture may fail in some edge cases; ignore.
    }
  }
  resizing = true;
  resizePhotoIdx = idx;
  resizeStart = { x: e.pageX, y: e.pageY };
  const photo = pages[currentPage].photos[idx];
  resizeOrig = {
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
  if (activeHandleElement && activeHandleElement !== e.currentTarget) {
    activeHandleElement.classList.remove('handle-active');
  }
  activeHandleElement = e.currentTarget || e.target;
  if (activeHandleElement) {
    activeHandleElement.classList.add('handle-active');
  }
  // Capture the pointer for reliable tracking during resize
  if (e.pointerId !== undefined && activeHandleElement && activeHandleElement.setPointerCapture) {
    try {
      activeHandleElement.setPointerCapture(e.pointerId);
      activePointerId = e.pointerId;
      capturedElement = activeHandleElement;
    } catch (err) {
      // Pointer capture may fail in some edge cases; ignore.
    }
  }
  resizing = true;
  resizePhotoIdx = idx;
  resizeStart = { x: e.pageX, y: e.pageY };
  const photo = pages[currentPage].photos[idx];
  resizeOrig = {
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
  currentPage = pageIndex;
  const photo = pages[currentPage].photos[idx];
  // In crop mode on the active photo, dragging the image moves
  // the image under a stationary mask instead of moving the box.
  if (cropMode && cropPhotoIdx === idx) {
    cropDragImage = true;
    cropImageDragStart = { x: pageX, y: pageY };
    cropImageOrigOffset = {
      x: photo.imageOffsetX || 0,
      y: photo.imageOffsetY || 0
    };
  } else {
    dragIdx = idx;
    dragging = true;
    dragStart = { x: pageX, y: pageY };
    dragPhotoStart = { x: photo.x, y: photo.y };
  }
  // Capture the pointer so we continue receiving events even
  // if the finger/pen moves outside the target element.
  if (originalEvent && originalEvent.pointerId !== undefined && target.setPointerCapture) {
    try {
      target.setPointerCapture(originalEvent.pointerId);
      activePointerId = originalEvent.pointerId;
      capturedElement = target;
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
  const pageWidth = pages[currentPage].size.width * 3;
  const pageHeight = pages[currentPage].size.height * 3;

   // Moving the image under a fixed crop mask
   if (cropMode && cropDragImage && cropPhotoIdx !== null) {
     const photo = pages[currentPage].photos[cropPhotoIdx];
     // Scale the screen delta to page coordinates
     const dx = (pageX - cropImageDragStart.x) / currentPageScale;
     const dy = (pageY - cropImageDragStart.y) / currentPageScale;

     let newOffsetX = cropImageOrigOffset.x + dx;
     let newOffsetY = cropImageOrigOffset.y + dy;

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

  if (dragging && dragIdx !== null) {
    const photo = pages[currentPage].photos[dragIdx];
    // Scale the screen delta to page coordinates
    const dx = (pageX - dragStart.x) / currentPageScale;
    const dy = (pageY - dragStart.y) / currentPageScale;
    let newX = dragPhotoStart.x + dx;
    let newY = dragPhotoStart.y + dy;
    newX = Math.max(0, Math.min(newX, pageWidth - photo.width));
    newY = Math.max(0, Math.min(newY, pageHeight - photo.height));
    photo.x = newX;
    photo.y = newY;
    render();
    return;
  }

  if (!resizing || resizePhotoIdx === null) return;
  const photo = pages[currentPage].photos[resizePhotoIdx];
  // Scale screen delta to page coordinates
  const dx = (pageX - resizeStart.x) / currentPageScale;
  const dy = (pageY - resizeStart.y) / currentPageScale;
  const minSize = 20;

  // In crop mode, we can either resize the mask (container)
  // or the underlying image (zoom). Distinguish via kind.
  if (cropMode && cropPhotoIdx === resizePhotoIdx && resizeOrig && resizeOrig.kind === 'image') {
    // Resize the underlying image while keeping the mask fixed.
    let newImageWidth = resizeOrig.imageWidth;
    let newImageHeight = resizeOrig.imageHeight;
    let newOffsetX = resizeOrig.imageOffsetX;
    let newOffsetY = resizeOrig.imageOffsetY;

    let widthChange = 0;
    let heightChange = 0;

    if (resizeOrig.handle === 'se') {
      widthChange = dx;
      heightChange = dy;
    } else if (resizeOrig.handle === 'sw') {
      widthChange = -dx;
      heightChange = dy;
    } else if (resizeOrig.handle === 'ne') {
      widthChange = dx;
      heightChange = -dy;
    } else if (resizeOrig.handle === 'nw') {
      widthChange = -dx;
      heightChange = -dy;
    }

    if (!resizeOrig.dominant) {
      resizeOrig.dominant = Math.abs(widthChange) >= Math.abs(heightChange) ? 'width' : 'height';
    }

    let scale = 1;
    if (resizeOrig.dominant === 'width') {
      scale = (resizeOrig.imageWidth + widthChange) / resizeOrig.imageWidth;
    } else {
      scale = (resizeOrig.imageHeight + heightChange) / resizeOrig.imageHeight;
    }

    // Prevent flipping or collapsing to zero, but no longer
    // force the image to fully cover the crop box – it may
    // be scaled smaller than the mask if the user zooms out.
    if (!Number.isFinite(scale) || scale <= 0) {
      scale = 0.01;
    }

    newImageWidth = resizeOrig.imageWidth * scale;
    newImageHeight = resizeOrig.imageHeight * scale;

    // Anchor the corner opposite to the dragged handle
    if (resizeOrig.handle === 'se') {
      // anchor top-left: offsets unchanged
      newOffsetX = resizeOrig.imageOffsetX;
      newOffsetY = resizeOrig.imageOffsetY;
    } else if (resizeOrig.handle === 'sw') {
      // anchor top-right
      const right = resizeOrig.imageOffsetX + resizeOrig.imageWidth;
      newOffsetX = right - newImageWidth;
      newOffsetY = resizeOrig.imageOffsetY;
    } else if (resizeOrig.handle === 'ne') {
      // anchor bottom-left
      const bottom = resizeOrig.imageOffsetY + resizeOrig.imageHeight;
      newOffsetX = resizeOrig.imageOffsetX;
      newOffsetY = bottom - newImageHeight;
    } else if (resizeOrig.handle === 'nw') {
      // anchor bottom-right
      const right = resizeOrig.imageOffsetX + resizeOrig.imageWidth;
      const bottom = resizeOrig.imageOffsetY + resizeOrig.imageHeight;
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
  } else if (cropMode && cropPhotoIdx === resizePhotoIdx) {
    // Resize the crop mask (container) while the image stays
    // the same size underneath. In crop mode we use edge
    // handles (n, s, e, w) that move a single edge.
    let newWidth = resizeOrig.width;
    let newHeight = resizeOrig.height;
    let newX = resizeOrig.x;
    let newY = resizeOrig.y;

    const handle = resizeOrig.handle;

    if (handle === 'e') {
      newWidth = resizeOrig.width + dx;
    } else if (handle === 'w') {
      newWidth = resizeOrig.width - dx;
      newX = resizeOrig.x + dx;
    } else if (handle === 's') {
      newHeight = resizeOrig.height + dy;
    } else if (handle === 'n') {
      newHeight = resizeOrig.height - dy;
      newY = resizeOrig.y + dy;
    }

    // If an aspect ratio is locked for the crop mask,
    // keep width/height in that ratio while the user
    // drags any of the mask handles. Horizontal drags
    // on side handles and vertical drags on top/bottom
    // handles are all that is needed; no diagonal drag
    // is required.
    if (cropAspectMode) {
      let ratio = 1; // width / height
      if (cropAspectMode === '4:3') {
        ratio = 4 / 3;
      } else if (cropAspectMode === '3:4') {
        ratio = 3 / 4;
      } else if (cropAspectMode === '1:1') {
        ratio = 1;
      }

      if (handle === 'e') {
        // Right edge: width driven by horizontal drag;
        // top-left corner remains anchored.
        newWidth = resizeOrig.width + dx;
        newHeight = newWidth / ratio;
        newX = resizeOrig.x;
        newY = resizeOrig.y;
      } else if (handle === 'w') {
        // Left edge: width driven by horizontal drag;
        // top-right corner remains anchored.
        newWidth = resizeOrig.width - dx;
        newHeight = newWidth / ratio;
        const right = resizeOrig.x + resizeOrig.width;
        newX = right - newWidth;
        newY = resizeOrig.y;
      } else if (handle === 's') {
        // Bottom edge: height driven by vertical drag;
        // top-left corner remains anchored.
        newHeight = resizeOrig.height + dy;
        newWidth = newHeight * ratio;
        newX = resizeOrig.x;
        newY = resizeOrig.y;
      } else if (handle === 'n') {
        // Top edge: height driven by vertical drag;
        // bottom-left corner remains anchored.
        newHeight = resizeOrig.height - dy;
        newWidth = newHeight * ratio;
        const bottom = resizeOrig.y + resizeOrig.height;
        newY = bottom - newHeight;
        newX = resizeOrig.x;
      }
    }

    if (newWidth < minSize) {
      const diff = minSize - newWidth;
      if (handle === 'w') {
        newX -= diff;
      }
      newWidth = minSize;
    }
    if (newHeight < minSize) {
      const diff = minSize - newHeight;
      if (handle === 'n') {
        newY -= diff;
      }
      newHeight = minSize;
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

    if (newWidth < minSize) newWidth = minSize;
    if (newHeight < minSize) newHeight = minSize;

    photo.width = newWidth;
    photo.height = newHeight;
    photo.x = newX;
    photo.y = newY;

    render();
  } else {
    // Normal resize: resize the bounding box and scale the
    // underlying image and any existing crop along with it.
    let newWidth = resizeOrig.width;
    let newHeight = resizeOrig.height;
    let newX = resizeOrig.x;
    let newY = resizeOrig.y;

    const aspect = resizeOrig.width / resizeOrig.height;
    const isCorner = ['nw', 'ne', 'se', 'sw'].includes(resizeOrig.handle);

    if (isCorner) {
      let widthChange = 0;
      let heightChange = 0;

      if (resizeOrig.handle === 'se') {
        widthChange = dx;
        heightChange = dy;
      } else if (resizeOrig.handle === 'sw') {
        widthChange = -dx;
        heightChange = dy;
      } else if (resizeOrig.handle === 'ne') {
        widthChange = dx;
        heightChange = -dy;
      } else if (resizeOrig.handle === 'nw') {
        widthChange = -dx;
        heightChange = -dy;
      }

      if (!resizeOrig.dominant) {
        resizeOrig.dominant = Math.abs(widthChange) >= Math.abs(heightChange) ? 'width' : 'height';
      }

      if (resizeOrig.dominant === 'width') {
        let targetWidth = resizeOrig.width + widthChange;
        if (targetWidth < minSize) targetWidth = minSize;
        newWidth = targetWidth;
        newHeight = newWidth / aspect;
      } else {
        let targetHeight = resizeOrig.height + heightChange;
        if (targetHeight < minSize) targetHeight = minSize;
        newHeight = targetHeight;
        newWidth = newHeight * aspect;
      }

      if (resizeOrig.handle === 'sw' || resizeOrig.handle === 'nw') {
        newX = resizeOrig.x + (resizeOrig.width - newWidth);
      }
      if (resizeOrig.handle === 'nw' || resizeOrig.handle === 'ne') {
        newY = resizeOrig.y + (resizeOrig.height - newHeight);
      }
    } else {
      if (resizeOrig.handle === 'e') {
        newWidth = resizeOrig.width + dx;
      } else if (resizeOrig.handle === 'w') {
        newWidth = resizeOrig.width - dx;
        newX = resizeOrig.x + dx;
      } else if (resizeOrig.handle === 's') {
        newHeight = resizeOrig.height + dy;
      } else if (resizeOrig.handle === 'n') {
        newHeight = resizeOrig.height - dy;
        newY = resizeOrig.y + dy;
      }

      if (newWidth < minSize) {
        const diff = minSize - newWidth;
        if (resizeOrig.handle === 'w') {
          newX -= diff;
        }
        newWidth = minSize;
      }
      if (newHeight < minSize) {
        const diff = minSize - newHeight;
        if (resizeOrig.handle === 'n') {
          newY -= diff;
        }
        newHeight = minSize;
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

    if (newWidth < minSize) newWidth = minSize;
    if (newHeight < minSize) newHeight = minSize;

    photo.width = newWidth;
    photo.height = newHeight;
    photo.x = newX;
    photo.y = newY;

    // Scale image and any existing crop with the box
    const scale = newWidth / resizeOrig.width;
    photo.imageWidth = resizeOrig.imageWidth * scale;
    photo.imageHeight = resizeOrig.imageHeight * scale;
    photo.imageOffsetX = resizeOrig.imageOffsetX * scale;
    photo.imageOffsetY = resizeOrig.imageOffsetY * scale;

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
  const hadInteraction = resizing || dragging || cropDragImage;

  // Release any captured pointer before resetting state
  if (activePointerId !== null && capturedElement && capturedElement.releasePointerCapture) {
    try {
      capturedElement.releasePointerCapture(activePointerId);
    } catch (err) {
      // Ignore if capture was already released.
    }
  }
  activePointerId = null;
  capturedElement = null;

  resizing = false;
  resizePhotoIdx = null;
  resizeStart = null;
  resizeOrig = null;
  dragging = false;
  dragIdx = null;
  dragStart = null;
  dragPhotoStart = null;
  cropDragImage = false;
  cropImageDragStart = null;
  cropImageOrigOffset = null;
  if (activeHandleElement) {
    activeHandleElement.classList.remove('handle-active');
    activeHandleElement = null;
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

// Initial render with sample photos on the first page
loadInitialSamplePhotos();
render();
