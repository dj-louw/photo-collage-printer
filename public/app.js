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
    const img = document.createElement('img');
    img.src = photo.src;
    img.className = 'photo';
    img.style.left = photo.x + 'px';
    img.style.top = photo.y + 'px';
    img.style.width = photo.width + 'px';
    img.style.height = photo.height + 'px';
    img.draggable = true;
    img.ondragstart = e => dragPhoto(e, idx);
    img.ondragend = e => dropPhoto(e, idx);
    img.onclick = () => selectPhoto(idx);
    div.appendChild(img);
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
      // Default max dimension
      const maxDim = 100;
      let width = img.naturalWidth;
      let height = img.naturalHeight;
      if (width > height) {
        if (width > maxDim) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        }
      } else {
        if (height > maxDim) {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
      }
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

function selectPhoto(idx) {
  // Placeholder for cropping, rotating, resizing, removing
  alert('Photo controls coming soon!');
}

render();
