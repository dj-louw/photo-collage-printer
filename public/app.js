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
    img.draggable = true;
    img.ondragstart = e => dragPhoto(e, idx);
    img.ondragend = e => dropPhoto(e, idx);
    img.onclick = () => selectPhoto(idx);
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

// Drag and drop (basic)
let dragIdx = null;
function dragPhoto(e, idx) {
  dragIdx = idx;
}
function dropPhoto(e, idx) {
  if (dragIdx !== null) {
    const photo = pages[currentPage].photos[dragIdx];
    photo.x = e.pageX - app.offsetLeft - 50;
    photo.y = e.pageY - app.offsetTop - 50;
    dragIdx = null;
    render();
  }
}

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
    }
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
