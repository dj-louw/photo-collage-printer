// Photo Collage Printer - app.js
// Main entry point for the web-app

const app = document.getElementById('app');

// State
let pages = [{
  size: { width: 210, height: 297 }, // A4 in mm
  photos: []
}];
let currentPage = 0;

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
  div.style.width = page.size.width * 3 + 'px'; // scale mm to px
  div.style.height = page.size.height * 3 + 'px';

  page.photos.forEach((photo, idx) => {
    // Container for image and handle
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = photo.x + 'px';
    container.style.top = photo.y + 'px';
    container.style.width = photo.width + 'px';
    container.style.height = photo.height + 'px';
    container.style.pointerEvents = 'auto';

    const img = document.createElement('img');
    img.src = photo.src;
    img.className = 'photo';
    img.style.width = '100%';
    img.style.height = '100%';
    img.onclick = e => {
      e.stopPropagation();
      selectPhoto(idx);
    };
    container.appendChild(img);

    // Show resize handles on corners and edges if selected
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
        container.appendChild(handle);
      });
    }
    // Add rotate icon for selected image
    if (selectedPhoto === idx) {
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
      rotateIcon.onclick = function(e) {
        e.stopPropagation();
        window.rotatePhoto(idx);
      };
      container.appendChild(rotateIcon);
    }
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
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      // Import at 50% of page width, retain aspect ratio
      const page = pages[currentPage];
      const targetWidth = page.size.width * 3 * 0.5; // scale mm to px, 50%
      let width = targetWidth;
      let height = img.naturalHeight * (targetWidth / img.naturalWidth);
      pages[currentPage].photos.push({
        src: e.target.result,
        x: 10,
        y: 10,
        width,
        height
      });
      render();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
};

window.printCollage = function() {
  window.print();
};

window.rotatePhoto = function(idx) {
  const photo = pages[currentPage].photos[idx];
  // Swap width and height, rotate 90deg clockwise
  // Adjust position so rotation pivots around top left
  const oldWidth = photo.width;
  const oldHeight = photo.height;
  photo.width = oldHeight;
  photo.height = oldWidth;
  // Clamp position so image stays within page
  const pageWidth = pages[currentPage].size.width * 3;
  const pageHeight = pages[currentPage].size.height * 3;
  if (photo.x + photo.width > pageWidth) {
    photo.x = pageWidth - photo.width;
  }
  if (photo.y + photo.height > pageHeight) {
    photo.y = pageHeight - photo.height;
  }
  render();
};

// Drag and drop (custom)
let dragIdx = null;
let dragOffset = null;
let dragging = false;

document.onmousedown = function(e) {
  // Only start drag if clicking on an image
  if (e.target.classList && e.target.classList.contains('photo')) {
    const idx = Array.from(e.target.parentElement.parentElement.children).indexOf(e.target.parentElement);
    dragIdx = idx;
    dragging = true;
    const photo = pages[currentPage].photos[idx];
    dragOffset = {
      x: e.pageX - app.offsetLeft - photo.x,
      y: e.pageY - app.offsetTop - photo.y
    };
    e.preventDefault();
  }
};

document.onmousemove = function(e) {
  if (dragging && dragIdx !== null) {
    const photo = pages[currentPage].photos[dragIdx];
    let newX = e.pageX - app.offsetLeft - dragOffset.x;
    let newY = e.pageY - app.offsetTop - dragOffset.y;
    const pageWidth = pages[currentPage].size.width * 3;
    const pageHeight = pages[currentPage].size.height * 3;
    newX = Math.max(0, Math.min(newX, pageWidth - photo.width));
    newY = Math.max(0, Math.min(newY, pageHeight - photo.height));
    photo.x = newX;
    photo.y = newY;
    render();
  }
};

document.onmouseup = function() {
  resizing = false;
  resizePhotoIdx = null;
  resizeStart = null;
  resizeOrig = null;
  dragging = false;
  dragIdx = null;
  dragOffset = null;
};
window.addEventListener('mouseup', function() {
  resizing = false;
  resizePhotoIdx = null;
  resizeStart = null;
  resizeOrig = null;
  dragging = false;
  dragIdx = null;
  dragOffset = null;
});

window.addEventListener('mousemove', function(e) {
  if (dragging && dragIdx !== null) {
    const photo = pages[currentPage].photos[dragIdx];
    let newX = e.pageX - app.offsetLeft - dragOffset.x;
    let newY = e.pageY - app.offsetTop - dragOffset.y;
    const pageWidth = pages[currentPage].size.width * 3;
    const pageHeight = pages[currentPage].size.height * 3;
    newX = Math.max(0, Math.min(newX, pageWidth - photo.width));
    newY = Math.max(0, Math.min(newY, pageHeight - photo.height));
    photo.x = newX;
    photo.y = newY;
    render();
  }
});

let selectedPhoto = null;
function selectPhoto(idx) {
  selectedPhoto = idx;
  render();
}

let resizing = false;
let resizeStart = null;
let resizePhotoIdx = null;
let resizeOrig = null;
document.onmousemove = function(e) {
  if (resizing && resizePhotoIdx !== null) {
    const photo = pages[currentPage].photos[resizePhotoIdx];
    const dx = e.pageX - resizeStart.x;
    const dy = e.pageY - resizeStart.y;
    let newWidth = resizeOrig.width;
    let newHeight = resizeOrig.height;
    let newX = photo.x;
    let newY = photo.y;
    const handle = resizeOrig.handle;
    const pageWidth = pages[currentPage].size.width * 3;
    const pageHeight = pages[currentPage].size.height * 3;
    if (["nw","ne","sw","se"].includes(handle)) {
      // Corners: always lock aspect ratio
      let widthChange = 0, heightChange = 0;
      if (handle === "nw") {
        widthChange = -dx;
        heightChange = -dy;
      } else if (handle === "ne") {
        widthChange = dx;
        heightChange = -dy;
      } else if (handle === "sw") {
        widthChange = -dx;
        heightChange = dy;
      } else if (handle === "se") {
        widthChange = dx;
        heightChange = dy;
      }
      // Lock dominant axis on first mousemove
      if (!resizeOrig.dominant) {
        resizeOrig.dominant = Math.abs(widthChange) > Math.abs(heightChange) ? 'width' : 'height';
      }
      const aspect = resizeOrig.width / resizeOrig.height;
      if (resizeOrig.dominant === 'width') {
        newWidth = resizeOrig.width + widthChange;
        newHeight = newWidth / aspect;
      } else {
        newHeight = resizeOrig.height + heightChange;
        newWidth = newHeight * aspect;
      }
      // Update position for left/top handles
      if (handle === "nw") {
        newX = resizeOrig.x + (resizeOrig.width - newWidth);
        newY = resizeOrig.y + (resizeOrig.height - newHeight);
      } else if (handle === "ne") {
        newY = resizeOrig.y + (resizeOrig.height - newHeight);
      } else if (handle === "sw") {
        newX = resizeOrig.x + (resizeOrig.width - newWidth);
      }
      // Stop resizing if any edge hits the page border
      if (newX < 0) {
        newWidth += newX;
        newHeight = newWidth / aspect;
        newX = 0;
      }
      if (newY < 0) {
        newHeight += newY;
        newWidth = newHeight * aspect;
        newY = 0;
      }
      if (newX + newWidth > pageWidth) {
        newWidth = pageWidth - newX;
        newHeight = newWidth / aspect;
      }
      if (newY + newHeight > pageHeight) {
        newHeight = pageHeight - newY;
        newWidth = newHeight * aspect;
      }
    } else {
      // Edges: allow stretching (break aspect ratio)
      if (handle === "n") {
        newHeight -= dy;
        newY = resizeOrig.y + (resizeOrig.height - newHeight);
      } else if (handle === "s") {
        newHeight += dy;
      } else if (handle === "w") {
        newWidth -= dx;
        newX = resizeOrig.x + (resizeOrig.width - newWidth);
      } else if (handle === "e") {
        newWidth += dx;
      }
      // Clamp position and size for edge handles
      newWidth = Math.max(20, newWidth);
      newHeight = Math.max(20, newHeight);
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
    }
    // Minimum size
    newWidth = Math.max(20, newWidth);
    newHeight = Math.max(20, newHeight);
    if (newWidth > 20 && newHeight > 20) {
      photo.width = newWidth;
      photo.height = newHeight;
      photo.x = newX;
      photo.y = newY;
      render();
    }
  }
};
document.onmouseup = function() {
  resizing = false;
  resizePhotoIdx = null;
  resizeStart = null;
  resizeOrig = null;
  dragging = false;
  dragIdx = null;
  dragOffset = null;
};
function startResize(e, idx) {
  e.stopPropagation();
  resizing = true;
  resizePhotoIdx = idx;
  resizeStart = { x: e.pageX, y: e.pageY };
  const photo = pages[currentPage].photos[idx];
    resizeOrig = {
      width: photo.width,
      height: photo.height,
      x: photo.x,
      y: photo.y,
      handle: e.target.getAttribute('data-handle'),
      startX: e.pageX,
      startY: e.pageY,
      dominant: null
    };
}

render();
