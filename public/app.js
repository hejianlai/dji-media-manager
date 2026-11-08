const grid = document.getElementById('grid');
const emptyEl = document.getElementById('empty');
const loadMoreButton = document.getElementById('loadMore');
const loadMoreCount = document.getElementById('loadMoreCount');
const searchEl = document.getElementById('search');
const typeEl = document.getElementById('typeFilter');
const sortEl = document.getElementById('sortFilter');
const previewOnlyEl = document.getElementById('previewOnly');
const statusEl = document.getElementById('status');
const rootInput = document.getElementById('rootInput');
const loadRootButton = document.getElementById('loadRoot');
const rootSelect = document.getElementById('rootSelect');
const selectedCountEl = document.getElementById('selectedCount');
const deleteSelectedButton = document.getElementById('deleteSelected');
const toastEl = document.getElementById('toast');

const viewer = document.getElementById('viewer');
const viewerBody = document.getElementById('viewerBody');
const viewerName = document.getElementById('viewerName');
const viewerDeleteButton = document.getElementById('viewerDelete');

const confirmDialog = document.getElementById('confirmDialog');
const confirmList = document.getElementById('confirmList');
const confirmDeleteButton = document.getElementById('confirmDelete');
const permanentCheckbox = document.getElementById('permanentDelete');

const progressDialog = document.getElementById('progressDialog');
const progressText = document.getElementById('progressText');
const progressBar = document.getElementById('progressBar');

let allFiles = [];
let selectedPaths = new Set();
let selectedFiles = new Map();
let visibleCache = [];
let renderedCount = 0;
let pendingConfirmPaths = [];
let toastTimer = 0;

const PAGE_SIZE = 48;
const MAX_RENDERED_CARDS = 120;
const SELECT_BATCH_SIZE = 400;

const PREVIEWABLE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'mp4', 'mov']);

function getExtension(file) {
  const index = file.name.lastIndexOf('.');
  return index < 0 ? '' : file.name.slice(index + 1).toLowerCase();
}

function isPreviewable(file) {
  return PREVIEWABLE_EXTENSIONS.has(getExtension(file));
}

function isLrf(file) {
  return getExtension(file) === 'lrf';
}

function showToast(message, duration = 4200) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

function sortFiles(files, mode) {
  const output = [...files];
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
  if (mode === 'time-desc') output.sort((a, b) => b.mtime - a.mtime || byName(a, b));
  else if (mode === 'time-asc') output.sort((a, b) => a.mtime - b.mtime || byName(a, b));
  else if (mode === 'size-desc') output.sort((a, b) => b.size - a.size || byName(a, b));
  else output.sort(byName);
  return output;
}

function getVisibleFiles() {
  const query = searchEl.value.trim().toLowerCase();
  const type = typeEl.value;
  const sortMode = sortEl.value;
  return sortFiles(
    allFiles.filter(file => {
      if (previewOnlyEl.checked && !file.previewable) return false;
      if (type !== 'all' && file.type !== type) return false;
      return !query || file.name.toLowerCase().includes(query);
    }),
    sortMode
  );
}

function updateSelectionUi() {
  selectedCountEl.textContent = String(selectedPaths.size);
  deleteSelectedButton.disabled = selectedPaths.size === 0;
}

function thumbUrl(file) {
  return `/api/thumb/${encodeURIComponent(file.name)}`;
}

function previewMarkup(file) {
  const url = thumbUrl(file);
  const ext = getExtension(file);
  const icon = ext === 'mp4' || ext === 'mov' ? '<span class="video-icon">▶</span>' : '';
  return `<img loading="lazy" decoding="async" alt="" src="${url}">${icon}`;
}

function createCard(file, index) {
  const card = document.createElement('article');
  card.className = selectedPaths.has(file.path) ? 'card selected' : 'card';
  card.dataset.path = file.path;

  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  thumb.dataset.openIndex = String(index);
  thumb.innerHTML = previewMarkup(file);

  const selectButton = document.createElement('button');
  selectButton.className = 'select-button';
  selectButton.type = 'button';
  selectButton.dataset.selectIndex = String(index);
  selectButton.title = '选择 / 取消选择';
  selectButton.textContent = selectedPaths.has(file.path) ? '✓' : '';

  const deleteButton = document.createElement('button');
  deleteButton.className = 'delete-button danger';
  deleteButton.type = 'button';
  deleteButton.dataset.deleteIndex = String(index);
  deleteButton.textContent = '删除';

  const meta = document.createElement('div');
  meta.className = 'meta';
  const name = document.createElement('div');
  name.className = 'file-name';
  name.textContent = file.name;
  name.title = file.path;
  const sub = document.createElement('div');
  sub.className = 'file-sub';
  const size = document.createElement('span');
  size.textContent = file.sizeText;
  const typeLabel = document.createElement('span');
  typeLabel.className = `badge ${file.type}`;
  typeLabel.textContent = file.type === 'video' ? '视频' : file.type === 'photo' ? '照片' : '其他';
  sub.append(size, typeLabel);
  meta.append(name, sub);
  card.append(selectButton, deleteButton, thumb, meta);
  return card;
}

function removeCardByPath(pathValue) {
  const selector = '.card[data-path="' + CSS.escape(pathValue) + '"]';
  const card = grid.querySelector(selector);
  if (!card) return false;
  card.remove();
  return true;
}

function updateLoadMoreUi() {
  const remaining = visibleCache.length - renderedCount;
  const shouldShow = remaining > 0;
  loadMoreButton.hidden = !shouldShow;
  loadMoreCount.textContent = shouldShow ? String(remaining) : '';
}

function renderCards() {
  const start = renderedCount;
  const end = Math.min(visibleCache.length, start + PAGE_SIZE);
  const fragment = document.createDocumentFragment();
  for (let index = start; index < end; index += 1) {
    fragment.append(createCard(visibleCache[index], index));
  }
  grid.append(fragment);
  renderedCount = end;
  updateLoadMoreUi();
}

function render({ resetScroll = true } = {}) {
  visibleCache = getVisibleFiles();
  grid.replaceChildren();
  renderedCount = 0;
  if (visibleCache.length === 0) {
    emptyEl.hidden = false;
    updateLoadMoreUi();
    updateSelectionUi();
    return;
  }

  emptyEl.hidden = true;
  // Render one small initial page. Additional pages remain explicit, so scrolling
  // cannot accidentally create hundreds of image/video decoding tasks.
  renderCards();
  if (resetScroll) window.scrollTo({ top: 0, behavior: 'instant' });
  updateSelectionUi();
}

function showViewer(index) {
  const list = visibleCache.filter(file => file.previewable);
  if (list.length === 0) return;
  const nextIndex = Math.max(0, Math.min(index, list.length - 1));
  const file = list[nextIndex];
  viewerName.textContent = `${nextIndex + 1} / ${list.length} · ${file.name}`;
  const src = `/api/preview/${encodeURIComponent(file.name)}`;
  viewerBody.innerHTML = getExtension(file) === 'mp4' || getExtension(file) === 'mov'
    ? `<video controls preload="metadata" playsinline src="${src}"></video>`
    : `<img src="${src}" alt="${file.name}">`;
  viewerDeleteButton.disabled = false;
  viewer.classList.add('open');
  viewer.dataset.index = String(nextIndex);
}

function closeViewer() {
  viewer.classList.remove('open');
  viewerBody.replaceChildren();
  viewerName.textContent = '预览';
  viewerDeleteButton.disabled = false;
  delete viewer.dataset.index;
}

function showConfirm(paths) {
  pendingConfirmPaths = paths;
  confirmDeleteButton.textContent = '确认删除';
  const items = paths.slice(0, 300);
  confirmList.replaceChildren();
  for (const pathValue of items) {
    const item = document.createElement('li');
    const pathEl = document.createElement('span');
    pathEl.className = 'path';
    pathEl.textContent = pathValue;
    const sizeEl = document.createElement('span');
    sizeEl.className = 'size';
    sizeEl.textContent = selectedFiles.get(pathValue)?.sizeText ?? '';
    item.append(pathEl, sizeEl);
    confirmList.append(item);
  }
  if (paths.length > items.length) {
    const extra = document.createElement('li');
    const text = document.createElement('span');
    text.className = 'path';
    text.textContent = `…其余 ${paths.length - items.length} 个文件`;
    const blank = document.createElement('span');
    extra.append(text, blank);
    confirmList.append(extra);
  }
  confirmDialog.classList.add('open');
}

function hideConfirm() {
  pendingConfirmPaths = [];
  confirmDialog.classList.remove('open');
}

async function deletePaths(paths, { permanent = false } = {}) {
  if (!paths.length) return;
  hideConfirm();
  progressDialog.classList.add('open');
  progressBar.style.width = '0%';
  const nameFor = pathValue => selectedFiles.get(pathValue)?.name ?? pathValue.split('/').pop();
  progressText.textContent = `正在从设备删除 0/${paths.length}…`;

  let successCount = 0;
  const failures = [];

  // Serial deletion avoids saturating the SD card controller and gives stable,
  // understandable progress for potentially slow removable media.
  for (const [index, pathValue] of paths.entries()) {
    progressText.textContent = `正在从设备删除 ${index + 1}/${paths.length}：${nameFor(pathValue)}`;
    try {
      const response = await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: [pathValue], permanent })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.deleted?.length !== 1) {
        throw new Error(result.failed?.[0]?.error || result.error || '删除失败');
      }
      successCount += 1;
      selectedPaths.delete(pathValue);
      selectedFiles.delete(pathValue);
      allFiles = allFiles.filter(file => file.path !== pathValue);
    } catch (error) {
      failures.push(`${nameFor(pathValue)}：${error.message}`);
    }
    progressBar.style.width = `${Math.round(((index + 1) / paths.length) * 100)}%`;
  }

  progressText.textContent = `完成：成功 ${successCount} 个，失败 ${failures.length} 个`;
  setTimeout(() => {
    progressDialog.classList.remove('open');

    // Keep the user's browsing position. Remove successfully deleted cards in
    // place and refresh only counters / remaining-card state.
    const remainingVisible = getVisibleFiles();
    const removedPaths = paths.filter(pathValue => !remainingVisible.some(file => file.path === pathValue));
    let removedCards = 0;
    for (const pathValue of removedPaths) removedCards += removeCardByPath(pathValue) ? 1 : 0;
    visibleCache = remainingVisible;
    renderedCount -= removedCards;
    if (renderedCount < 0) renderedCount = 0;
    updateLoadMoreUi();
    updateSelectionUi();

    if (failures.length) showToast(failures.slice(0, 3).join('；'));
    else showToast(`已删除 ${successCount} 个文件`);
  }, 500);
}

function renderRootOptions(current, roots) {
  rootSelect.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = roots.length ? '自动发现…' : '未发现媒体目录';
  rootSelect.append(placeholder);
  for (const rootPath of roots) {
    const option = document.createElement('option');
    option.value = rootPath;
    option.textContent = rootPath.replace(/^\/Volumes\//, '');
    if (pathSame(rootPath, current)) option.selected = true;
    rootSelect.append(option);
  }
}

function pathSame(a, b) {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

async function loadRoots() {
  try {
    const response = await fetch('/api/roots', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    rootInput.value = data.current;
    renderRootOptions(data.current, data.roots);
    return data.current;
  } catch (error) {
    showToast(`读取目录候选失败：${error.message}`);
    return null;
  }
}

async function switchRoot(requestedPath) {
  const target = requestedPath.trim();
  if (!target) return;
  loadRootButton.disabled = true;
  rootSelect.disabled = true;
  statusEl.textContent = '正在切换目录…';
  try {
    const response = await fetch('/api/root', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: target })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    selectedPaths.clear();
    selectedFiles.clear();
    rootInput.value = data.current;
    renderRootOptions(data.current, data.roots);
    await loadRootButton.addEventListener('click', () => switchRoot(rootInput.value));

document.getElementById('supportAuthor').addEventListener('click', () => {
  window.open('/reward.html', '_blank');
});

rootInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') switchRoot(rootInput.value);
});

rootSelect.addEventListener('change', () => {
  const value = rootSelect.value;
  if (!value) {
    rootInput.value = rootSelect.querySelector('option[selected]')?.value || rootInput.value;
    return;
  }
  switchRoot(value);
});

loadRoots().then(current => {
  if (current) loadFiles();
  else showToast('未自动发现媒体目录，请输入绝对路径后点击“加载”');
});

    showToast(`已切换到 ${data.current}`);
  } catch (error) {
    showToast(error.message);
    statusEl.textContent = '目录切换失败';
  } finally {
    loadRootButton.disabled = false;
    rootSelect.disabled = false;
  }
}

async function loadFiles() {
  statusEl.textContent = '正在读取存储卡…';
  try {
    const response = await fetch('/api/files', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    allFiles = data.files;
    statusEl.textContent = `${data.root} · ${allFiles.length} 个文件`;
    if (!rootInput.value.trim()) rootInput.value = data.root;
    render();
  } catch (error) {
    statusEl.textContent = '读取失败';
    showToast(error.message);
  }
}

async function selectAllVisible() {
  const paths = visibleCache.map(file => file.path);
  if (paths.length > SELECT_BATCH_SIZE) {
    showToast(`一次最多选择 ${SELECT_BATCH_SIZE} 个文件`);
    return;
  }
  for (const file of visibleCache) {
    selectedPaths.add(file.path);
    selectedFiles.set(file.path, file);
  }
  updateSelectionUi();
}

grid.addEventListener('click', event => {
  const deleteButton = event.target.closest('[data-delete-index]');
  if (deleteButton) {
    const file = visibleCache[Number(deleteButton.dataset.deleteIndex)];
    if (file) showConfirm([file.path]);
    return;
  }

  const selectButton = event.target.closest('[data-select-index]');
  if (selectButton) {
    const file = visibleCache[Number(selectButton.dataset.selectIndex)];
    if (!file) return;
    if (selectedPaths.has(file.path)) {
      selectedPaths.delete(file.path);
      selectedFiles.delete(file.path);
    } else {
      selectedPaths.add(file.path);
      selectedFiles.set(file.path, file);
    }
    selectButton.closest('.card')?.classList.toggle('selected', selectedPaths.has(file.path));
    selectButton.textContent = selectedPaths.has(file.path) ? '✓' : '';
    updateSelectionUi();
    return;
  }

  const thumb = event.target.closest('[data-open-index]');
  if (thumb) {
    const requestedIndex = Number(thumb.dataset.openIndex);
    const priorCount = visibleCache.slice(0, requestedIndex + 1).filter(file => file.previewable).length;
    showViewer(priorCount - 1);
  }
});

searchEl.addEventListener('input', () => render());
typeEl.addEventListener('change', () => render());
sortEl.addEventListener('change', () => render());
previewOnlyEl.addEventListener('change', () => render());

loadMoreButton.addEventListener('click', () => {
  if (renderedCount >= visibleCache.length) return;
  // Cap total cards in the DOM so very large result sets cannot exhaust memory.
  if (renderedCount >= MAX_RENDERED_CARDS) {
    showToast(`为避免页面卡死，最多渲染 ${MAX_RENDERED_CARDS} 个卡片；请用搜索或筛选缩小范围`);
    return;
  }
  renderCards();
});

document.getElementById('selectVisible').addEventListener('click', () => selectAllVisible());

document.getElementById('clearSelection').addEventListener('click', () => {
  selectedPaths.clear();
  selectedFiles.clear();
  updateSelectionUi();
  grid.querySelectorAll('.card.selected').forEach(card => {
    card.classList.remove('selected');
    card.querySelector('.select-button').textContent = '';
  });
});

document.getElementById('selectLrf').addEventListener('click', () => {
  const lrfFiles = allFiles.filter(isLrf);
  if (lrfFiles.length === 0) {
    showToast('当前目录没有 LRF 文件');
    return;
  }
  if (lrfFiles.length > SELECT_BATCH_SIZE) {
    showToast(`LRF 文件有 ${lrfFiles.length} 个，一次最多选择 ${SELECT_BATCH_SIZE} 个`);
    return;
  }
  for (const file of lrfFiles) {
    selectedPaths.add(file.path);
    selectedFiles.set(file.path, file);
  }
  previewOnlyEl.checked = false;
  render();
  showToast(`已选择 ${lrfFiles.length} 个 LRF 低码率文件`);
});

deleteSelectedButton.addEventListener('click', () => showConfirm([...selectedPaths]));

document.getElementById('confirmCancel').addEventListener('click', hideConfirm);

confirmDeleteButton.addEventListener('click', () => {
  const paths = pendingConfirmPaths;
  const permanent = permanentCheckbox.checked;
  if (!paths.length) return;
  confirmDeleteButton.disabled = true;
  deletePaths(paths, { permanent }).finally(() => {
    confirmDeleteButton.disabled = false;
  });
});

viewerDeleteButton.addEventListener('click', () => {
  const index = Number(viewer.dataset.index);
  const list = visibleCache.filter(file => file.previewable);
  const file = list[index];
  if (!file) return;
  closeViewer();
  showConfirm([file.path]);
});
document.getElementById('viewerClose').addEventListener('click', closeViewer);
document.getElementById('viewerPrev').addEventListener('click', () => {
  showViewer(Number(viewer.dataset.index || 0) - 1);
});
document.getElementById('viewerNext').addEventListener('click', () => {
  showViewer(Number(viewer.dataset.index || 0) + 1);
});

viewer.addEventListener('click', event => {
  if (event.target === viewer) closeViewer();
});
confirmDialog.addEventListener('click', event => {
  if (event.target === confirmDialog) hideConfirm();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeViewer();
    hideConfirm();
  }
  if (viewer.classList.contains('open')) {
    if (event.key === 'ArrowLeft') document.getElementById('viewerPrev').click();
    if (event.key === 'ArrowRight') document.getElementById('viewerNext').click();
  }
});

loadRootButton.addEventListener('click', () => switchRoot(rootInput.value));

document.getElementById('supportAuthor').addEventListener('click', () => {
  window.open('/reward.html', '_blank');
});

rootInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') switchRoot(rootInput.value);
});

rootSelect.addEventListener('change', () => {
  const value = rootSelect.value;
  if (!value) {
    rootInput.value = rootSelect.querySelector('option[selected]')?.value || rootInput.value;
    return;
  }
  switchRoot(value);
});

loadRoots().then(current => {
  if (current) loadFiles();
  else showToast('未自动发现媒体目录，请输入绝对路径后点击“加载”');
});

