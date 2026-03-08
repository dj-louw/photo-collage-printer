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

// Drag state
let dragIdx = null;
let dragOffset = null;
let dragging = false;

// Resize state
let resizing = false;
let resizeStart = null;
let resizePhotoIdx = null;
let resizeOrig = null;

function render() {
  app.innerHTML = '';
  renderPageControls();
  renderPhotoControls();
  renderCollagePage();
}

function renderPageControls() {
  const div = document.createElement('div');
  div.className = 'page-controls';
  div.innerHTML = `
    <button onclick="addPage()">Add Page</button>
    <button onclick="removePage()">Remove Page</button>
    <label>Page Size:
      <select onchange="changePageSize(this.value)">
        <option value="A4">A4</option>
        <option value="Letter">Letter</option>
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
  const page = pages[currentPage];
  const div = document.createElement('div');
  div.className = 'collage-page';
  const pageWidthPx = page.size.width * 3;
  const pageHeightPx = page.size.height * 3;
  div.style.width = pageWidthPx + 'px';
  div.style.height = pageHeightPx + 'px';

  page.photos.forEach((photo, idx) => {
    // Unrotated container: positions the photo on the page
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = photo.x + 'px';
    container.style.top = photo.y + 'px';
    container.style.width = photo.width + 'px';
    container.style.height = photo.height + 'px';
    container.style.pointerEvents = 'auto';
    container.dataset.photoIndex = String(idx);

    // Rotated wrapper: rotates image + resize handles around center
    const rotateWrapper = document.createElement('div');
    rotateWrapper.style.position = 'absolute';
    rotateWrapper.style.left = '0';
    rotateWrapper.style.top = '0';
    rotateWrapper.style.width = '100%';
    rotateWrapper.style.height = '100%';
    rotateWrapper.style.transformOrigin = 'center center';
    rotateWrapper.style.transform = `rotate(${photo.rotation || 0}deg)`;

    const img = document.createElement('img');
    img.src = photo.src;
    img.className = 'photo';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';
    img.onclick = e => {
      e.stopPropagation();
      selectPhoto(idx);
    };
    rotateWrapper.appendChild(img);

    // Show resize handles if selected
    if (selectedPhoto === idx) {
      const handlePositions = [
        { name: 'nw', left: '-8px', top: '-8px', cursor: 'nwse-resize' },
        { name: 'ne', right: '-8px', top: '-8px', cursor: 'nesw-resize' },
        { name: 'sw', left: '-8px', bottom: '-8px', cursor: 'nesw-resize' },
        { name: 'se', right: '-8px', bottom: '-8px', cursor: 'nwse-resize' },
        { name: 'n', left: '50%', top: '-8px', cursor: 'ns-resize', transform: 'translateX(-50%)' },
        { name: 's', left: '50%', bottom: '-8px', cursor: 'ns-resize', transform: 'translateX(-50%)' },
        { name: 'w', left: '-8px', top: '50%', cursor: 'ew-resize', transform: 'translateY(-50%)' },
        { name: 'e', right: '-8px', top: '50%', cursor: 'ew-resize', transform: 'translateY(-50%)' }
      ];
      handlePositions.forEach(pos => {
        const handle = document.createElement('div');
        handle.className = 'resize-handle';
        handle.style.position = 'absolute';
        if (pos.left) handle.style.left = pos.left;
        if (pos.right) handle.style.right = pos.right;
        if (pos.top) handle.style.top = pos.top;
        if (pos.bottom) handle.style.bottom = pos.bottom;
        if (pos.transform) handle.style.transform = pos.transform;
        handle.style.width = '16px';
        handle.style.height = '16px';
        handle.style.background = '#0078d4';
        handle.style.borderRadius = '50%';
        handle.style.cursor = pos.cursor;
        handle.setAttribute('data-handle', pos.name);
        handle.onmousedown = e => startResize(e, idx, pos.name);
        rotateWrapper.appendChild(handle);
      });

      // Rotate icon: stays at top-left of unrotated bounding box
      const rotateIcon = document.createElement('img');
      rotateIcon.src = 'icons/file-rotate-right.svg';
      rotateIcon.alt = 'Rotate';
      rotateIcon.style.position = 'absolute';
      rotateIcon.style.left = '-24px';
      rotateIcon.style.top = '-24px';
      rotateIcon.style.width = '24px';
      rotateIcon.style.height = '24px';
      rotateIcon.style.background = 'white';
      rotateIcon.style.borderRadius = '50%';
      rotateIcon.style.boxShadow = '0 1px 4px rgba(0,0,0,0.15)';
      rotateIcon.style.cursor = 'pointer';
      rotateIcon.onclick = e => {
        e.stopPropagation();
        rotatePhoto(idx);
      };
      container.appendChild(rotateIcon);
    }

    container.appendChild(rotateWrapper);
    div.appendChild(container);
  });

  app.appendChild(div);
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
        rotation: 0
      });
      selectedPhoto = page.photos.length - 1;
      render();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
};

window.printCollage = function() {
  window.print();
};

// Selection helper
function selectPhoto(idx) {
  selectedPhoto = idx;
  render();
}

// Rotate photo by 90 degrees clockwise
function rotatePhoto(idx) {
  const photo = pages[currentPage].photos[idx];
  const current = photo.rotation || 0;
  photo.rotation = (current + 90) % 360;
  render();
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
    width: photo.width,
    height: photo.height,
    x: photo.x,
    y: photo.y,
    handle,
    dominant: null
  };
}

// Global mouse handlers for drag + resize
document.addEventListener('mousedown', function(e) {
  // Only start drag if clicking directly on an image (not handles/icons)
  if (!(e.target.classList && e.target.classList.contains('photo'))) return;

  const container = e.target.closest('[data-photo-index]');
  if (!container) return;

  const idx = Number(container.dataset.photoIndex);
  if (Number.isNaN(idx)) return;

  dragIdx = idx;
  dragging = true;
  const photo = pages[currentPage].photos[idx];
  dragOffset = {
    x: e.pageX - app.offsetLeft - photo.x,
    y: e.pageY - app.offsetTop - photo.y
  };
  e.preventDefault();
});

document.addEventListener('mousemove', function(e) {
  const pageWidth = pages[currentPage].size.width * 3;
  const pageHeight = pages[currentPage].size.height * 3;

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
      let targetWidth = resizeOrig.width + (resizeOrig.handle === 'sw' || resizeOrig.handle === 'nw' ? -widthChange : widthChange);
      if (targetWidth < minSize) targetWidth = minSize;
      newWidth = targetWidth;
      newHeight = newWidth / aspect;
    } else {
      let targetHeight = resizeOrig.height + (resizeOrig.handle === 'ne' || resizeOrig.handle === 'nw' ? -heightChange : heightChange);
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

  render();
});

document.addEventListener('mouseup', function() {
  resizing = false;
  resizePhotoIdx = null;
  resizeStart = null;
  resizeOrig = null;
  dragging = false;
  dragIdx = null;
  dragOffset = null;
});

// Initial render
render();
