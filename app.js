const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const statProgress = document.getElementById('statProgress');
const statSpeed = document.getElementById('statSpeed');
const statElapsed = document.getElementById('statElapsed');
const statEntries = document.getElementById('statEntries');
const actionsSection = document.getElementById('actionsSection');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const previewSection = document.getElementById('previewSection');
const previewTableBody = document.getElementById('previewTableBody');
const errorMessage = document.getElementById('errorMessage');
const errorText = document.getElementById('errorText');
const converterCard = document.getElementById('converterCard');


const CSV_HEADERS = [
  'index',
  'startedDateTime',
  'method',
  'url',
  'status',
  'statusText',
  'mimeType',
  'time_ms',
  'requestBodySize',
  'responseBodySize',
  'serverIPAddress'
];

// App State Variables
let csvLines = [];
let entriesCount = 0;
let bytesRead = 0;
let fileTotalSize = 0;
let startTime = 0;
let activeInterval = null;
let currentCsvBlobUrl = null;

// Parser State Variables
let parserState = 'FIND_ENTRIES_KEY';
let carryOver = '';
let nestingLevel = 0;
let inString = false;
let escapeNext = false;
let currentEntry = '';

// Drag and drop event listeners
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleFileSelection(files[0]);
  }
});

browseBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    handleFileSelection(fileInput.files[0]);
  }
});

resetBtn.addEventListener('click', resetUI);

/**
 * Safely escapes HTML entities to prevent XSS.
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Escapes a field for standard RFC 4180 CSV compliance.
 */
function escapeCsvCell(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Initiates the streaming file read and parse pipeline.
 */
async function handleFileSelection(file) {
  if (!file) return;
  if (!file.name.endsWith('.har') && file.type !== 'application/json') {
    showError('Unsupported file type. Please select a valid .har file.');
    return;
  }

  // Reset any previous state
  resetState();
  
  fileTotalSize = file.size;
  fileName.textContent = file.name;
  fileSize.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
  
  // Transition UI
  dropzone.style.display = 'none';
  progressSection.style.display = 'block';
  errorMessage.style.display = 'none';

  startTime = Date.now();
  
  // Update running timer in the UI
  activeInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    statElapsed.textContent = `${elapsed.toFixed(1)}s`;
  }, 100);

  // Initialize CSV accumulation with headers
  csvLines.push(CSV_HEADERS.join(',') + '\n');

  try {
    const stream = file.stream();
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');
    let lastYieldBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytesRead += value.length;
      const textChunk = decoder.decode(value, { stream: true });
      processChunk(textChunk);

      // Periodically yield control back to the UI thread (every 1MB)
      // to render progress bar movements and stats smoothly.
      if (bytesRead - lastYieldBytes > 1024 * 1024) {
        lastYieldBytes = bytesRead;
        updateProgressUI();
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // Flush any remaining decoder bytes
    const remainingText = decoder.decode();
    if (remainingText) {
      processChunk(remainingText);
    }

    // Check if we actually found entries
    if (entriesCount === 0) {
      throw new Error("No HTTP request entries found in this HAR file. Ensure it is a valid web log export.");
    }

    finishConversion(file.name);

  } catch (err) {
    showError(`Error reading file: ${err.message}`);
    clearInterval(activeInterval);
  }
}

/**
 * Character-by-character JSON state engine to isolate array items streamingly.
 */
function processChunk(chunkText) {
  let i = 0;
  const len = chunkText.length;

  while (i < len) {
    if (parserState === 'FIND_ENTRIES_KEY') {
      const searchStr = carryOver + chunkText.substring(i);
      const index = searchStr.indexOf('"entries"');
      
      if (index !== -1) {
        const matchIndexInChunk = i + index - carryOver.length;
        parserState = 'FIND_ARRAY_START';
        carryOver = '';
        i = matchIndexInChunk + 9;
      } else {
        carryOver = searchStr.slice(-15);
        break;
      }
    } 
    else if (parserState === 'FIND_ARRAY_START') {
      const char = chunkText[i];
      if (char === '[') {
        parserState = 'PARSE_ENTRIES';
      }
      i++;
    } 
    else if (parserState === 'PARSE_ENTRIES') {
      const char = chunkText[i];

      if (nestingLevel === 0) {
        if (char === '{') {
          nestingLevel = 1;
          inString = false;
          escapeNext = false;
          currentEntry = '{';
        } else if (char === ']') {
          parserState = 'FINISHED';
          break;
        }
      } else {
        currentEntry += char;
        if (escapeNext) {
          escapeNext = false;
        } else if (char === '\\') {
          escapeNext = true;
        } else if (char === '"') {
          inString = !inString;
        } else if (!inString) {
          if (char === '{') {
            nestingLevel++;
          } else if (char === '}') {
            nestingLevel--;
            if (nestingLevel === 0) {
              handleEntryParsed(currentEntry);
              currentEntry = '';
            }
          }
        }
      }
      i++;
    } 
    else if (parserState === 'FINISHED') {
      break;
    }
  }
}

/**
 * Parses the isolated entry JSON, extracts selected cells, escapes them,
 * and updates live statistics / previews.
 */
function handleEntryParsed(entryJson) {
  try {
    const entry = JSON.parse(entryJson);
    entriesCount++;

    const req = entry.request || {};
    const res = entry.response || {};
    const content = res.content || {};

    const row = [
      entriesCount,
      entry.startedDateTime || '',
      req.method || '',
      req.url || '',
      res.status !== undefined ? res.status : '',
      res.statusText || '',
      content.mimeType || '',
      entry.time !== undefined ? entry.time : '',
      req.bodySize !== undefined ? req.bodySize : '',
      res.bodySize !== undefined ? res.bodySize : '',
      entry.serverIPAddress || ''
    ];

    const csvLine = row.map(escapeCsvCell).join(',') + '\n';
    csvLines.push(csvLine);

    // Populate live preview table with the first 10 requests
    if (entriesCount <= 10) {
      appendPreviewRow(entry, entriesCount);
      if (entriesCount === 1) {
        previewSection.style.display = 'block';
      }
    }
  } catch (err) {
    console.warn(`Failed to parse entry #${entriesCount + 1}:`, err.message);
  }
}

/**
 * Safely inserts a row into the preview table.
 */
function appendPreviewRow(entry, index) {
  const req = entry.request || {};
  const res = entry.response || {};
  const content = res.content || {};

  const status = res.status;
  let statusClass = 'success';
  if (status >= 400) statusClass = 'error';
  else if (status >= 300) statusClass = 'redirect';

  const method = (req.method || 'GET').toLowerCase();
  let methodClass = 'other';
  if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
    methodClass = method;
  }

  const rowHtml = `
    <tr>
      <td>${index}</td>
      <td><span class="method-pill ${methodClass}">${escapeHtml(req.method || 'GET')}</span></td>
      <td title="${escapeHtml(req.url)}">${escapeHtml(req.url)}</td>
      <td><span class="status-pill ${statusClass}">${status !== undefined ? status : '-'}</span></td>
      <td>${escapeHtml(content.mimeType || '-')}</td>
      <td>${entry.time !== undefined ? Math.round(entry.time) : '-'}</td>
    </tr>
  `;
  previewTableBody.insertAdjacentHTML('beforeend', rowHtml);
}

/**
 * Updates progress bars and performance stats.
 */
function updateProgressUI() {
  const percent = fileTotalSize > 0 ? (bytesRead / fileTotalSize) * 100 : 0;
  progressBar.style.width = `${percent.toFixed(1)}%`;
  statProgress.textContent = `${Math.round(percent)}%`;

  const elapsed = (Date.now() - startTime) / 1000;
  if (elapsed > 0) {
    const speed = (bytesRead / (1024 * 1024)) / elapsed;
    statSpeed.textContent = `${speed.toFixed(1)} MB/s`;
  }
  
  statEntries.textContent = entriesCount;
}

/**
 * Finalizes the conversion: prepares Blob, registers downloads, and completes animations.
 */
function finishConversion(originalFileName) {
  clearInterval(activeInterval);
  
  // Fill 100% stats accurately
  progressBar.style.width = '100%';
  progressBar.classList.add('success');
  statProgress.textContent = '100%';
  statEntries.textContent = entriesCount;
  
  const elapsed = (Date.now() - startTime) / 1000;
  statElapsed.textContent = `${elapsed.toFixed(1)}s`;
  
  const finalSpeed = (fileTotalSize / (1024 * 1024)) / elapsed;
  statSpeed.textContent = `${finalSpeed.toFixed(1)} MB/s`;

  // Change style card border to green indicator
  converterCard.classList.add('success');

  // Create Blob of CSV data
  const blob = new Blob(csvLines, { type: 'text/csv;charset=utf-8;' });
  currentCsvBlobUrl = URL.createObjectURL(blob);
  
  // Set up download button action
  downloadBtn.onclick = () => {
    const link = document.createElement('a');
    link.href = currentCsvBlobUrl;
    
    // Derive output CSV filename
    const nameWithoutExt = originalFileName.substring(0, originalFileName.lastIndexOf('.')) || originalFileName;
    link.setAttribute('download', `${nameWithoutExt}.csv`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Reveal download options
  actionsSection.style.display = 'flex';
  
  // Auto-click download for ultimate ease-of-use
  downloadBtn.click();
}

function showError(msg) {
  errorText.textContent = msg;
  errorMessage.style.display = 'flex';
  progressSection.style.display = 'none';
  dropzone.style.display = 'flex';
  clearInterval(activeInterval);
}

function resetState() {
  csvLines = [];
  entriesCount = 0;
  bytesRead = 0;
  fileTotalSize = 0;
  startTime = 0;
  
  parserState = 'FIND_ENTRIES_KEY';
  carryOver = '';
  nestingLevel = 0;
  inString = false;
  escapeNext = false;
  currentEntry = '';

  if (currentCsvBlobUrl) {
    URL.revokeObjectURL(currentCsvBlobUrl);
    currentCsvBlobUrl = null;
  }
}

function resetUI() {
  resetState();
  
  // Restore elements visibility
  dropzone.style.display = 'flex';
  progressSection.style.display = 'none';
  actionsSection.style.display = 'none';
  previewSection.style.display = 'none';
  errorMessage.style.display = 'none';
  
  // Clear layout values
  progressBar.style.width = '0%';
  progressBar.classList.remove('success');
  converterCard.classList.remove('success');
  previewTableBody.innerHTML = '';
  fileInput.value = '';
  
  statProgress.textContent = '0%';
  statSpeed.textContent = '0 MB/s';
  statElapsed.textContent = '0.0s';
  statEntries.textContent = '0';
}

// Auto-load test file if ?test=true is present
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('test') === 'true') {
  fetch('/dummy_large.har')
    .then(res => res.blob())
    .then(blob => {
      const file = new File([blob], 'dummy_large.har', { type: 'application/json' });
      handleFileSelection(file);
    })
    .catch(err => {
      showError(`Test mode error: ${err.message}`);
    });
}
