// === fileLoader.js (atualizado) ===
// Suporta múltiplos pacotes com contexto, pacotes colapsáveis, download por pacote,
// fila de processamento para múltiplos uploads, e refresh global.

window.__cpiPackages = [];
window.__cpiActivePkgId = null;

// [PD] --- Partner Directory global ---
window.__partnerDirectory = { raw: null, flat: {} };

// ---------- Fila de processamento para uploads ----------
let __zipQueue = [];
let __zipProcessing = false;

async function enqueueZip(file, opts = {}) {
  __zipQueue.push({ file, opts });
  if (__zipProcessing) return;
  __zipProcessing = true;
  try {
    while (__zipQueue.length) {
      const { file: f, opts: o } = __zipQueue.shift();
      await handleZipFile(f, o);
    }
  } finally {
    __zipProcessing = false;
  }
}

// ---------- Helpers ----------
function __makePkgId() { return 'pkg_' + Math.random().toString(36).slice(2, 9); }

function setActivePackage(pkgId) {
  const pkg = window.__cpiPackages.find(p => p.id === pkgId);
  if (!pkg) return;
  window.__cpiActivePkgId = pkgId;
  // Atualiza compat com código legado
  fileContents = pkg.fileContents;
  resourcesCntDecoded = pkg.resourcesCntDecoded;
  // Destaque visual
  document.querySelectorAll('.pkg-container').forEach(el => el.classList.remove('pkg-active'));
  if (pkg.container) pkg.container.classList.add('pkg-active');
}

function injectOnce(id, cssText) {
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = cssText;
  document.head.appendChild(style);
}

function createPackageContainer(zipName) {
  const container = document.createElement('div');
  container.className = 'pkg-container result-section';
  

  const headerBar = document.createElement('div');
  headerBar.className = 'pkg-headerbar';
  container.appendChild(headerBar);

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'result-title pkg-header';
  header.setAttribute('aria-expanded', 'false');
  header.innerHTML = `<span class="pkg-caret">►</span> <span class="pkg-title">📦 ${escapeHtml(zipName)}</span>`;
  headerBar.appendChild(header);
  header.classList.add("collapsed");

  const actions = document.createElement('div');
  actions.className = 'pkg-actions';
  headerBar.appendChild(actions);

  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'download-btn';
  downloadBtn.title = 'Baixar recursos decodificados deste pacote';
  downloadBtn.textContent = '⬇️ Baixar';
  actions.appendChild(downloadBtn);

  const content = document.createElement('div');
  content.className = 'pkg-content';
  content.style.display = 'none'; // começa colapsado
  container.appendChild(content);

  injectOnce('pkg-collapsible-style', `
    .pkg-container { border: 1px solid #2a2a2a; border-radius: 8px; margin-bottom: 16px; }
    .pkg-headerbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .pkg-header { cursor: pointer; background: transparent; border: none; color: inherit; padding: 8px 0; text-align: left; }
    .pkg-container.pkg-active { box-shadow: 0 0 0 2px rgba(100, 180, 255, 0.3) inset; }
    .pkg-actions .download-btn { padding: 6px 10px; border-radius: 8px; border: 1px solid #3a3a3a; background: #1f1f1f; color: #eee; cursor: pointer; }
    .pkg-actions .download-btn:hover { background: #2a2a2a; }
    .pkg-caret { display:inline-block; width:1.25em; }
  `);

  results.appendChild(container);

  return { container, content, header, actions, downloadBtn };
}

// ---------- Dedup simples (previne duplo clique do mesmo arquivo) ----------
window.__cpi_lastKey = null;
window.__cpi_lastTime = 0;
function fileKey(file) { return `${file.name}|${file.size}|${file.lastModified}`; }
function isDuplicateCall(key) {
  const now = Date.now();
  if (window.__cpi_lastKey === key && (now - window.__cpi_lastTime) < 1500) return true;
  window.__cpi_lastKey = key;
  window.__cpi_lastTime = now;
  return false;
}

// ---------- Processamento de um ZIP ----------
async function handleZipFile(file, { append = undefined, expand = false } = {}) {
  const key = fileKey(file);
  if (isDuplicateCall(key)) return;

  try {
    const hasContent = results && results.children && results.children.length > 0;
    if (append === undefined) append = hasContent;
  } catch (e) { append = !!append; }

  if (handleZipFile.__running) {
    // Se alguém chamar direto sem fila, encaminhamos para fila
    return enqueueZip(file, { append, expand });
  }
  handleZipFile.__running = true;

  const pkg = {
    id: __makePkgId(),
    name: file.name,
    fileContents: {},
    resourcesCntDecoded: "",
    container: null,
    contentEl: null,
    downloadBtn: null
  };

  try {
    originalZipName = file.name;

    if (!append) {
      results.innerHTML = "";
    }
    const ui = createPackageContainer(file.name);
    pkg.container = ui.container;
    pkg.contentEl = ui.content;
    pkg.downloadBtn = ui.downloadBtn;

    window.__cpiPackages.push(pkg);
    setActivePackage(pkg.id);

    // Header: ativa + colapsa/expande
    ui.header.addEventListener('click', () => {
      setActivePackage(pkg.id);
      const expanded = ui.header.getAttribute('aria-expanded') === 'true';
      ui.header.setAttribute('aria-expanded', String(!expanded));
      const caret = ui.header.querySelector('.pkg-caret');
      if (caret) caret.textContent = expanded ? '►' : '▼';
      ui.content.style.display = expanded ? 'none' : 'block';
    });

    // Se expand = true (multi upload), já abre
    if (expand) {
      ui.header.setAttribute('aria-expanded', 'true');
      const caret = ui.header.querySelector('.pkg-caret');
      if (caret) caret.textContent = '▼';
      ui.content.style.display = 'block';
    }

    // Botão download por pacote
    if (pkg.downloadBtn) {
      pkg.downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setActivePackage(pkg.id);
        downloadResourcesForPackage(pkg);
      });
    }

    const zip = new JSZip();
    const loadedZip = await zip.loadAsync(file);

    const promises = [];
    loadedZip.forEach((relativePath, zipEntry) => {
      let fileType = "string";
      if (zipEntry.name.endsWith("_content") || /\.(zip|jar)$/i.test(zipEntry.name)) {
        fileType = "arraybuffer";
      }
      const p = zipEntry.async(fileType).then((content) => {
        pkg.fileContents[zipEntry.name] = content;
      });
      promises.push(p);
    });

    await Promise.all(promises);

    const resourcesCnt = pkg.fileContents["resources.cnt"];
    const contentMetadata = pkg.fileContents["contentmetadata.md"];

    if (resourcesCnt) {
      processFileWithContext("resources.cnt", resourcesCnt, pkg);
    }
    if (contentMetadata) {
      processFileWithContext("contentmetadata.md", contentMetadata, pkg);
    }
    if (!resourcesCnt && !contentMetadata) {
      displayIflowFileListForContext(pkg);
    }

    // Clique local em itens do pacote
    pkg.contentEl.addEventListener('click', (e) => {
      const li = e.target.closest('li.script-item');
      if (li && li.dataset.filePath) {
        setActivePackage(pkg.id);
        openIflowFileWithContext(li.dataset.filePath, pkg);
      }
      const res = e.target.closest('li.script-item[data-resource-id]');
      if (res) {
        setActivePackage(pkg.id);
        const rid = res.dataset.resourceId;
        const rtype = res.dataset.resourceType;
        const name = res.querySelector('.script-name')?.textContent || rid;
        openResourceInMonacoWithContext(rid, name, rtype, pkg);
      }
    });

    return true;
  } catch (err) {
    console.error("Erro no handleZipFile (context):", err);
    alert("Falha ao processar o arquivo ZIP. Veja o console para detalhes.");
    return false;
  } finally {
    handleZipFile.__running = false;
  }
}

// ---------- Múltiplos ZIPs (mantido por compatibilidade) ----------
async function handleZipFileMultiple(fileList) {
  // Agora apenas enfileira, para garantir ordem e não perder nenhum
  const files = Array.from(fileList || []);
  const multi = files.length > 1;
  for (const f of files) {
    await enqueueZip(f, { append: true, expand: multi });
  }
}

// ---------- Versões com contexto para exibição/abertura ----------
function processFileWithContext(fileName, content, pkg) {
  const resultDiv = document.createElement("div");
  resultDiv.className = "result-section";
  let processedContent = "";
  let title = "";
  try {
    if (fileName === "contentmetadata.md") {
      title = t("content_metadata_title");
      const decoded = atob(String(content).trim());
      processedContent = `<div class="code-block">${escapeHtml(decoded)}</div>`;
    } else if (fileName === "resources.cnt") {
      title = t("package_resources_title");
      const decoded = atob(String(content).trim());
      const jsonData = JSON.parse(decoded);
      pkg.resourcesCntDecoded = JSON.stringify(jsonData, null, 2);
      processedContent = `<div class="json-viewer">${formatPackageInfo(jsonData)}</div>`;
    }
    if (title) {
      resultDiv.innerHTML = `<div class="result-title">${title}</div>${processedContent}`;
      pkg.contentEl.appendChild(resultDiv);
    }
  } catch (error) {
    resultDiv.innerHTML = `<div class="result-title error">${t("processing_error_title")}${fileName}</div>` +
      `<div class="error">${t("error_label")}${error.message}</div>` +
      `<div class="code-block">${escapeHtml(String(content).substring(0, 500))}...</div>`;
    pkg.contentEl.appendChild(resultDiv);
  }
}

function displayIflowFileListForContext(pkg) {
  const files = Object.keys(pkg.fileContents).filter((name) => !name.endsWith("/"));
  if (files.length === 0) return;
  const resultDiv = document.createElement("div");
  resultDiv.className = "result-section";
  let html = `<div class="result-title">${t("iflow_files_title")}</div>`;
  html += '<ul class="script-list">';
  files.forEach((fn) => {
    const displayName = fn.split("/").pop();
    html += `<li class="script-item" data-file-path="${fn}">` +
            `<div class="script-name">${escapeHtml(displayName)}</div>` +
            `<div class="script-type">${escapeHtml(fn)}</div>` +
            `</li>`;
  });
  html += '</ul>';
  html += `<p style="margin-top: 15px; color: #666; font-style: italic;">${t("file_click_hint")}</p>`;
  resultDiv.innerHTML = html;
  pkg.contentEl.appendChild(resultDiv);
}

function openResourceInMonacoWithContext(resourceId, resourceName, resourceType, pkg) {
  let content;
  let fileName = resourceName;

  if (resourceType && resourceType.toUpperCase() === "CONTENTPACKAGE") {
    if (!pkg.resourcesCntDecoded) {
      alert(t("no_resources"));
      return;
    }
    content = pkg.resourcesCntDecoded;
    fileName = "resources.cnt.json";
  } else {
    const contentFileName = resourceId + "_content";
    content = pkg.fileContents[contentFileName];
    if (!content) {
      alert(t("no_content"));
      return;
    }
  }

  modalTitle.textContent = `📄 ${resourceName}`;
  modal.style.display = "block";
  modal.classList.add("show");
  modal.querySelector(".modal-content").classList.add("show");

  if (!monacoEditor) {
    require(["vs/editor/editor.main"], function () {
      initializeMonacoEditor(content, fileName, pkg.fileContents);
    });
  } else {
    loadContentIntoMonaco(content, fileName, pkg.fileContents);
  }
}

function openIflowFileWithContext(filePath, pkg) {
  const content = pkg.fileContents[filePath];
  if (!content) {
    alert(t("file_not_found") + filePath);
    return;
  }

  modalTitle.textContent = `📄 ${filePath}`;
  modal.style.display = "block";
  modal.classList.add("show");
  modal.querySelector(".modal-content").classList.add("show");

  if (!monacoEditor) {
    require(["vs/editor/editor.main"], function () {
      initializeMonacoEditor(content, filePath, pkg.fileContents);
    });
  } else {
    loadContentIntoMonaco(content, filePath, pkg.fileContents);
  }
}

// ---------- Compat com funções antigas ----------
function openResourceInMonaco(resourceId, resourceName, resourceType) {
  const pkg = window.__cpiPackages.find(p => p.id === window.__cpiActivePkgId);
  if (pkg) return openResourceInMonacoWithContext(resourceId, resourceName, resourceType, pkg);

  // Fallback legado
  let content;
  let fileName = resourceName;
  if (resourceType && resourceType.toUpperCase() === "CONTENTPACKAGE") {
    if (!resourcesCntDecoded) { alert(t("no_resources")); return; }
    content = resourcesCntDecoded;
    fileName = "resources.cnt.json";
  } else {
    const contentFileName = resourceId + "_content";
    content = getFileContent(contentFileName);
    if (!content) { alert(t("no_content")); return; }
  }
  modalTitle.textContent = `📄 ${resourceName}`;
  modal.style.display = "block";
  modal.classList.add("show");
  if (!monacoEditor) {
    require(["vs/editor/editor.main"], function () {
      initializeMonacoEditor(content, fileName, fileContents);
    });
  } else {
    loadContentIntoMonaco(content, fileName, fileContents);
  }
}

function openIflowFile(filePath) {
  const pkg = window.__cpiPackages.find(p => p.id === window.__cpiActivePkgId);
  if (pkg) return openIflowFileWithContext(filePath, pkg);

  const content = getFileContent(filePath);
  if (!content) { alert(t("file_not_found") + filePath); return; }
  modalTitle.textContent = `📄 ${filePath}`;
  modal.style.display = "block";
  modal.classList.add("show");
  if (!monacoEditor) {
    require(["vs/editor/editor.main"], function () {
      initializeMonacoEditor(content, filePath);
    });
  } else {
    loadContentIntoMonaco(content, filePath);
  }
}

// ---------- Utilitários já existentes ----------
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatPackageInfo(data) {
  let html = "";
  if (data.resources) {
    html += `<h5>${t("resources_found")}</h5>`;
    html += '<ul class="script-list">';
    data.resources.forEach((resource) => {
      const urlDataAttr = resource.additionalAttributes && resource.additionalAttributes.url
        ? ` data-resource-url="${resource.additionalAttributes.url.attributeValues}"`
        : "";
      html += `<li class="script-item" data-resource-id="${resource.id}" data-resource-type="${resource.resourceType}"${urlDataAttr}>` +
              `<div class="script-name">${escapeHtml(resource.displayName || resource.name)}</div>` +
              `<div class="script-type">${t("resource_details")
                .replace('{type}', resource.resourceType)
                .replace('{version}', resource.semanticVersion || resource.version)
                .replace('{user}', resource.modifiedBy || "")}</div>` +
              `</li>`;
    });
    html += "</ul>";
    html += `<p style="margin-top: 15px; color: #666; font-style: italic;">${t("resource_click_hint")}</p>`;
  }
  return html;
}

// ---------- Download por pacote ----------
function downloadResourcesForPackage(pkg) {
  const outZip = new JSZip();
  const tasks = [];

  let packageInfo = null;
  if (pkg.resourcesCntDecoded) {
    try { packageInfo = JSON.parse(pkg.resourcesCntDecoded); } catch (e) {}
  }

  if (packageInfo && packageInfo.resources) {
    packageInfo.resources.forEach((resource) => {
      const id = resource.id;
      const name = (resource.displayName || resource.name || id).replace(/[\s/\\?%*:|"<>]/g, "_");
      const content = pkg.fileContents[id + "_content"];
      if (!content) return;
      if (resource.resourceType === "ScriptCollection" ||
          (resource.contentType && (resource.contentType.includes("zip") || resource.contentType.includes("octet-stream")))) {
        const inner = new JSZip();
        const task = inner
          .loadAsync(content)
          .then((innerZip) => {
            const innerTasks = [];
            innerZip.forEach((relPath, entry) => {
              if (!entry.dir) {
                innerTasks.push(entry.async("arraybuffer").then((data) => {
                  outZip.file(name + "/" + relPath, data);
                }));
              }
            });
            return Promise.all(innerTasks);
          })
          .catch(() => {
            outZip.file(name, content);
          });
        tasks.push(task);
      } else {
        let fileExtension = ".txt";
        const resourceName = resource.name || resource.displayName;
        const extensionMatch = resourceName && resourceName.match(/\.([^.]+)$/);
        if (extensionMatch) {
          fileExtension = `.${extensionMatch[1]}`;
        } else if (resource.contentType) {
          const ct = resource.contentType;
          if (ct.includes("groovy")) fileExtension = ".groovy";
          else if (ct.includes("javascript")) fileExtension = ".js";
          else if (ct.includes("xml")) fileExtension = ".xml";
        }
        outZip.file(`${name}${extensionMatch ? "" : fileExtension}`, content);
      }
    });
  } else {
    // Fallback: exporta tudo que tiver *_content
    Object.keys(pkg.fileContents).forEach((k) => {
      if (!k.endsWith("_content")) return;
      outZip.file(k.replace(/[\s/\\?%*:|"<>]/g, "_"), pkg.fileContents[k]);
    });
  }

  try {
    const metadataContent = pkg.fileContents["contentmetadata.md"];
    if (metadataContent) {
      const decodedMetadata = atob(String(metadataContent).trim());
      outZip.file("contentmetadata_decoded.md", decodedMetadata);
    }
  } catch (e) {
    console.error("Erro ao decodificar metadados para o ZIP", e);
  }

  if (pkg.resourcesCntDecoded) {
    outZip.file("resources_decoded.json", pkg.resourcesCntDecoded);
  }

  outZip.generateAsync({ type: "blob" }).then((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const decodedName = pkg.name.replace(/\.zip$/i, "_decoded.zip");
    a.download = decodedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  });
}

// ---------- Refresh global ----------
function globalRefresh() {
  if (typeof results !== "undefined" && results) {
    results.innerHTML = "";
  }
  window.__cpiPackages = [];
  window.__cpiActivePkgId = null;
  try { fileContents = {}; } catch(e){}
  try { resourcesCntDecoded = ""; } catch(e){}

  const downloadSection = document.getElementById("downloadSection");
  if (downloadSection) downloadSection.style.display = "block";

  // [PD] limpa partner directory carregado
  window.__partnerDirectory = { raw: null, flat: {} };
  const el = document.getElementById('pdStatus');
  if (el) { el.style.display = 'none'; el.textContent = ''; }
}

// [PD] ---------- Partner Directory: leitura e flatten ----------
function __flattenPartnerDirectory(pdObj) {
  const out = {};
  if (!pdObj || typeof pdObj !== 'object') return out;
  Object.keys(pdObj).forEach(group => {
    const entry = pdObj[group];
    if (entry && typeof entry === 'object') {
      Object.keys(entry).forEach(k => {
        out[k] = entry[k];
      });
    }
  });
  return out;
}

async function handlePartnerDirectoryFile(file) {
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const flat = __flattenPartnerDirectory(json);
    window.__partnerDirectory.raw = json;
    window.__partnerDirectory.flat = flat;
    try {
      const el = document.getElementById('pdStatus');
      if (el) { el.style.display = 'inline'; el.textContent = `Partner Directory carregado (${Object.keys(flat).length} chaves)`; }
    } catch(e){}
    console.log('[PartnerDirectory] carregado:', Object.keys(flat));
    alert('Partner Directory carregado com sucesso.');
  } catch (e) {
    console.error('Falha ao ler PartnerDirectory.json:', e);
    alert('Falha ao ler PartnerDirectory.json. Verifique o JSON.');
  }
}

// [PD] ---------- UI: Upload PartnerDirectory.json ----------
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('uploadPDBtn');
  const input = document.getElementById('pdInput');
  if (btn && input) {
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (f) handlePartnerDirectoryFile(f);
      input.value = '';
    });
  }
});
