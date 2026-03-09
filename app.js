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
let dragOffset = null;
let dragging = false;

// Resize state (handles on the bounding box / crop mask)
let resizing = false;
let resizeStart = null;
let resizePhotoIdx = null;
let resizeOrig = null;

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

function render() {
  app.innerHTML = '';
  renderPageControls();
  renderPhotoControls();
  renderCollagePage();
}

function renderPageControls() {
  const div = document.createElement('div');
  div.className = 'page-controls';
  const page = pages[currentPage];
  const isLetter = page.size.width === 216 && page.size.height === 279;
  const currentSizeValue = isLetter ? 'Letter' : 'A4';
  div.innerHTML = `
    <button onclick="addPage()">Add Page</button>
    <button onclick="removePage()">Remove Page</button>
    <label>Page Size:
      <select onchange="changePageSize(this.value)">
        <option value="A4" ${currentSizeValue === 'A4' ? 'selected' : ''}>A4</option>
        <option value="Letter" ${currentSizeValue === 'Letter' ? 'selected' : ''}>Letter</option>
      </select>
    </label>
    <span>Page ${currentPage + 1} of ${pages.length}</span>
  `;
  app.appendChild(div);
}

function renderPhotoControls() {
  const div = document.createElement('div');
  div.className = 'photo-controls';
  div.innerHTML = `
    <input type="file" accept="image/*" onchange="importPhoto(event)">
    <button onclick="printCollage()">Print</button>
  `;
  app.appendChild(div);
}

function renderCollagePage() {
  // Render all pages vertically, like a word processor
  // document. The currentPage index still tracks which
  // page new photos are added to and which one the
  // page controls refer to, but you can scroll through
  // and interact with every page.
  pages.forEach((page, pageIndex) => {
    const div = document.createElement('div');
    div.className = 'collage-page';
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

    // Inner mask wrapper: clips only the image, not the
    // handles/icons that sit around the bounding box.
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
    // The image can extend beyond the mask; the
    // mask div acts as the clipping region.
    img.style.position = 'absolute';
    img.style.left = (photo.imageOffsetX || 0) + 'px';
    img.style.top = (photo.imageOffsetY || 0) + 'px';
    img.style.width = photo.imageWidth + 'px';
    img.style.height = photo.imageHeight + 'px';
    img.onclick = e => {
      e.stopPropagation();
      selectPhoto(pageIndex, idx);
    };

    mask.appendChild(img);
    container.appendChild(mask);

    // Show resize/crop handles only for the selected
    // photo on the active page.
    if (isSelectedOnActivePage) {
      const inCropMode = cropMode && cropPhotoIdx === idx;

      // In crop mode, use edge handles that move a single edge
      // in/out. Outside crop mode, show a single lower-right
      // handle that looks like the image zoom handle.
      const handlePositions = inCropMode
        ? [
            { name: 's', left: '50%', bottom: '-32px', cursor: 'ns-resize', transform: 'translateX(-50%)' },
            { name: 'w', left: '-32px', top: '50%', cursor: 'ew-resize', transform: 'translateY(-50%)' },
            { name: 'e', right: '-32px', top: '50%', cursor: 'ew-resize', transform: 'translateY(-50%)' }
          ]
        : [
            { name: 'se', right: '-32px', bottom: '-32px', cursor: 'nwse-resize' }
          ];

      handlePositions.forEach(pos => {
        const handle = document.createElement('div');
        // Use the same base colouring/border for all resize
        // handles; crop handles stay square via borderRadius.
        handle.className = 'resize-handle image-resize-handle';
        handle.style.position = 'absolute';
        if (pos.left) handle.style.left = pos.left;
        if (pos.right) handle.style.right = pos.right;
        if (pos.top) handle.style.top = pos.top;
        if (pos.bottom) handle.style.bottom = pos.bottom;
        if (pos.transform) handle.style.transform = pos.transform;
        handle.style.width = '32px';
        handle.style.height = '32px';
        handle.style.background = '#ffffff';
        // In crop mode, handles are squares; otherwise circles.
        handle.style.borderRadius = inCropMode ? '0' : '50%';
        handle.style.cursor = pos.cursor;
        handle.setAttribute('data-handle', pos.name);
        handle.onmousedown = e => {
          currentPage = pageIndex;
          startResize(e, idx, pos.name);
        };

        // For the non-crop resize handle, embed the same
        // arrow icon used by the image zoom handle.
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

        // In crop mode, place directional expand icons
        // on the edge handles: left icon on right edge,
        // right icon on left edge, up icon on bottom edge.
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

        container.appendChild(handle);
      });

      // In crop mode, also show an outer bounding box around the
      // full image with its own resize handles for zooming.
      if (inCropMode) {
        const imageFrame = document.createElement('div');
        imageFrame.className = 'image-frame';
        imageFrame.style.position = 'absolute';
        imageFrame.style.left = (photo.imageOffsetX || 0) + 'px';
        imageFrame.style.top = (photo.imageOffsetY || 0) + 'px';
        imageFrame.style.width = photo.imageWidth + 'px';
        imageFrame.style.height = photo.imageHeight + 'px';

        // Only show a single image resize handle in the
        // lower-right corner, offset further out so it
        // does not overlap the crop mask handle.
        const imgHandle = document.createElement('div');
        imgHandle.className = 'resize-handle image-resize-handle';
        imgHandle.style.position = 'absolute';
        imgHandle.style.right = '-32px';
        imgHandle.style.bottom = '-32px';
        imgHandle.style.width = '32px';
        imgHandle.style.height = '32px';
        imgHandle.style.background = '#ffffff';
        imgHandle.style.borderRadius = '50%';
        imgHandle.style.cursor = 'nwse-resize';
        imgHandle.setAttribute('data-handle', 'se');
        imgHandle.onmousedown = e => {
          currentPage = pageIndex;
          startImageResize(e, idx, 'se');
        };

        // Center the custom resize icon inside the handle.
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

        imageFrame.appendChild(imgHandle);

        container.appendChild(imageFrame);
      }

      // Rotate button: styled div wrapper with centered icon,
      // aligned with the left edge of the visible crop box
      // and placed just above it.
      const rotateButton = document.createElement('div');
      rotateButton.className = 'resize-handle image-resize-handle';
      // Do not include this control when capturing the
      // collage for PDF; external file:// images can
      // taint the canvas in some browsers.
      rotateButton.setAttribute('data-html2canvas-ignore', 'true');
      rotateButton.style.position = 'absolute';
      // Left edge aligned with the crop box's left edge
      rotateButton.style.left = '0';
      // 8px above the top edge of the crop box
      rotateButton.style.top = '-40px';
      rotateButton.style.width = '32px';
      rotateButton.style.height = '32px';
      rotateButton.style.background = 'white';
      rotateButton.style.borderRadius = '50%';
      rotateButton.style.cursor = 'pointer';
      rotateButton.onclick = e => {
        e.stopPropagation();
        currentPage = pageIndex;
        rotatePhoto(idx);
      };

      const rotateIcon = document.createElement('img');
      rotateIcon.src = 'icons/file-rotate-right.svg';
      rotateIcon.alt = 'Rotate';
      rotateIcon.style.position = 'absolute';
      rotateIcon.style.left = '50%';
      rotateIcon.style.top = '50%';
      rotateIcon.style.transform = 'translate(-50%, -50%)';
      rotateIcon.style.width = '20px';
      rotateIcon.style.height = '20px';
      rotateIcon.style.pointerEvents = 'none';
      rotateButton.appendChild(rotateIcon);

      container.appendChild(rotateButton);

      // Crop button: styled div wrapper with centered icon,
      // placed to the right of the rotate button.
      const cropButton = document.createElement('div');
      // Extra class so we can visually indicate active crop mode.
      cropButton.className = 'resize-handle image-resize-handle crop-toggle';
      cropButton.setAttribute('data-html2canvas-ignore', 'true');
      cropButton.style.position = 'absolute';
      // Placed to the right of the rotate button with a
      // small horizontal gap, same size & vertical offset.
      cropButton.style.left = '40px';
      cropButton.style.top = '-40px';
      cropButton.style.width = '32px';
      cropButton.style.height = '32px';
      cropButton.style.background = 'white';
      cropButton.style.borderRadius = '50%';
      cropButton.style.cursor = 'pointer';
      cropButton.onclick = e => {
        e.stopPropagation();
        currentPage = pageIndex;
        toggleCrop(idx);
      };

      const cropIcon = document.createElement('img');
      cropIcon.src = 'icons/crop.svg';
      cropIcon.alt = 'Crop';
      cropIcon.style.position = 'absolute';
      cropIcon.style.left = '50%';
      cropIcon.style.top = '50%';
      cropIcon.style.transform = 'translate(-50%, -50%)';
      cropIcon.style.width = '20px';
      cropIcon.style.height = '20px';
      cropIcon.style.pointerEvents = 'none';
      cropButton.appendChild(cropIcon);

      container.appendChild(cropButton);

      // Aspect-ratio preset buttons (only visible in crop mode).
      if (inCropMode) {
        const ratioButtons = [
          { mode: '4:3', icon: 'icons/crop-landscape.svg', offset: 80 },
          { mode: '3:4', icon: 'icons/crop-portrait.svg', offset: 120 },
          { mode: '1:1', icon: 'icons/crop-square.svg', offset: 160 }
        ];

        ratioButtons.forEach(cfg => {
          const btn = document.createElement('div');
          let classNames = 'resize-handle image-resize-handle crop-ratio-toggle';
          if (cropAspectMode === cfg.mode) classNames += ' crop-ratio-active';
          btn.className = classNames;
          btn.setAttribute('data-html2canvas-ignore', 'true');
          btn.style.position = 'absolute';
          btn.style.left = cfg.offset + 'px';
          btn.style.top = '-40px';
          btn.style.width = '32px';
          btn.style.height = '32px';
          btn.style.background = 'white';
          btn.style.borderRadius = '50%';
          btn.style.cursor = 'pointer';

          btn.onclick = e => {
            e.stopPropagation();
            currentPage = pageIndex;

            const pageForAspect = pages[currentPage];
            const photoForAspect = pageForAspect.photos[idx];

            if (cropAspectMode === cfg.mode) {
              // Toggle off if already active
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
          iconEl.style.position = 'absolute';
          iconEl.style.left = '50%';
          iconEl.style.top = '50%';
          iconEl.style.transform = 'translate(-50%, -50%)';
          iconEl.style.width = '20px';
          iconEl.style.height = '20px';
          iconEl.style.pointerEvents = 'none';
          btn.appendChild(iconEl);

          container.appendChild(btn);
        });
      }

      // Delete button: round control aligned with the
      // bottom-left corner of the crop box. Only shown
      // when the photo is selected.
      const deleteButton = document.createElement('div');
      deleteButton.className = 'resize-handle image-resize-handle';
      deleteButton.setAttribute('data-html2canvas-ignore', 'true');
      deleteButton.style.position = 'absolute';
      deleteButton.style.left = '0';
      deleteButton.style.bottom = '-40px';
      deleteButton.style.width = '32px';
      deleteButton.style.height = '32px';
      deleteButton.style.background = 'white';
      deleteButton.style.borderRadius = '50%';
      deleteButton.style.cursor = 'pointer';
      deleteButton.onclick = e => {
        e.stopPropagation();
        currentPage = pageIndex;
        deletePhoto(pageIndex, idx);
      };

      const deleteIcon = document.createElement('img');
      deleteIcon.src = 'icons/delete-outline.svg';
      deleteIcon.alt = 'Delete photo';
      deleteIcon.style.position = 'absolute';
      deleteIcon.style.left = '50%';
      deleteIcon.style.top = '50%';
      deleteIcon.style.transform = 'translate(-50%, -50%)';
      deleteIcon.style.width = '20px';
      deleteIcon.style.height = '20px';
      deleteIcon.style.pointerEvents = 'none';
      deleteButton.appendChild(deleteIcon);

      container.appendChild(deleteButton);

      // Size readout: aspect ratio and physical dimensions
      // for the visible crop box, shown on the right edge
      // of the selected image.
      const wPx = Math.max(1, photo.width);
      const hPx = Math.max(1, photo.height);
      const wInt = Math.round(wPx);
      const hInt = Math.round(hPx);
      const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
      const g = gcd(wInt, hInt) || 1;
      const arW = Math.round(wInt / g);
      const arH = Math.round(hInt / g);
      const mmWidth = wPx / 3;  // 3 px per mm
      const mmHeight = hPx / 3;

      const info = document.createElement('div');
      info.className = 'photo-size-info';
      info.setAttribute('data-html2canvas-ignore', 'true');
      info.style.position = 'absolute';
      info.style.left = '100%';
      info.style.top = '0';
      info.style.marginLeft = '8px';
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
      const sizeLine = document.createElement('div');
      sizeLine.textContent =
        mmWidth.toFixed(1) + ' × ' + mmHeight.toFixed(1) + ' mm';

      info.appendChild(aspectLine);
      info.appendChild(sizeLine);
      container.appendChild(info);
    }

    div.appendChild(container);
  });

  app.appendChild(div);
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

  // Create a PDF sized to A4 by default (portrait)
  const pdf = new jsPDF('portrait', 'mm', 'a4');
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

    const newSrc = canvas.toDataURL('image/png');

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

// Global mouse handlers for drag + resize
document.addEventListener('mousedown', function(e) {
  // Only start drag if clicking directly on an image (not handles/icons)
  if (!(e.target.classList && e.target.classList.contains('photo'))) return;

  const container = e.target.closest('[data-photo-index]');
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
    cropImageDragStart = { x: e.pageX, y: e.pageY };
    cropImageOrigOffset = {
      x: photo.imageOffsetX || 0,
      y: photo.imageOffsetY || 0
    };
  } else {
    dragIdx = idx;
    dragging = true;
    dragOffset = {
      x: e.pageX - app.offsetLeft - photo.x,
      y: e.pageY - app.offsetTop - photo.y
    };
  }
  e.preventDefault();
});

document.addEventListener('mousemove', function(e) {
  const pageWidth = pages[currentPage].size.width * 3;
  const pageHeight = pages[currentPage].size.height * 3;

   // Moving the image under a fixed crop mask
   if (cropMode && cropDragImage && cropPhotoIdx !== null) {
     const photo = pages[currentPage].photos[cropPhotoIdx];
     const dx = e.pageX - cropImageDragStart.x;
     const dy = e.pageY - cropImageDragStart.y;

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
    let newX = e.pageX - app.offsetLeft - dragOffset.x;
    let newY = e.pageY - app.offsetTop - dragOffset.y;
    newX = Math.max(0, Math.min(newX, pageWidth - photo.width));
    newY = Math.max(0, Math.min(newY, pageHeight - photo.height));
    photo.x = newX;
    photo.y = newY;
    render();
    return;
  }

  if (!resizing || resizePhotoIdx === null) return;
  const photo = pages[currentPage].photos[resizePhotoIdx];
  const dx = e.pageX - resizeStart.x;
  const dy = e.pageY - resizeStart.y;
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
});

document.addEventListener('mouseup', function() {
  resizing = false;
  resizePhotoIdx = null;
  resizeStart = null;
  resizeOrig = null;
  dragging = false;
  dragIdx = null;
  dragOffset = null;
  cropDragImage = false;
  cropImageDragStart = null;
  cropImageOrigOffset = null;
});

// Initial render
render();
