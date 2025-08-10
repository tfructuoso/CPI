
// ===== Suporte a múltiplos pacotes com contexto =====
window.__cpiPackages = [];
window.__cpiActivePkgId = null;

function __makePkgId() {
  return 'pkg_' + Math.random().toString(36).slice(2, 9);
}

function setActivePackage(pkgId) {
  const pkg = window.__cpiPackages.find(p => p.id === pkgId);
  if (!pkg) return;
  window.__cpiActivePkgId = pkgId;

  // Atualiza os "globais" para manter compatibilidade com funções existentes
  fileContents = pkg.fileContents;
  resourcesCntDecoded = pkg.resourcesCntDecoded;

  // Realça visualmente o pacote ativo
  document.querySelectorAll('.pkg-container').forEach(el => el.classList.remove('pkg-active'));
  if (pkg.container) pkg.container.classList.add('pkg-active');
}

function createPackageContainer(zipName) {
  const container = document.createElement('div');
  container.className = 'pkg-container result-section';

  const headerBar = document.createElement('div');
  headerBar.className = 'pkg-headerbar';
  container.appendChild(headerBar);

  const header = document.createElement('div');
  header.className = 'result-title pkg-header';
  header.textContent = `📦 ${zipName}`;
  headerBar.appendChild(header);

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
  container.appendChild(content);

  // Estilos básicos
  const style = document.createElement('style');
  style.textContent = `
    .pkg-container { border: 1px solid #2a2a2a; border-radius: 8px; margin-bottom: 16px; }
    .pkg-headerbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .pkg-container .pkg-header { cursor: pointer; }
    .pkg-container.pkg-active { box-shadow: 0 0 0 2px rgba(100, 180, 255, 0.4) inset; }
    .pkg-actions .download-btn { padding: 6px 10px; border-radius: 8px; border: 1px solid #3a3a3a; background: #1f1f1f; color: #eee; cursor: pointer; }
    .pkg-actions .download-btn:hover { background: #2a2a2a; }
  `;
  document.head.appendChild(style);

  results.appendChild(container);

  return { container, content, header, actions, downloadBtn };
}

// ===== Dedup simples por arquivo (nome|tamanho|mtime) =====
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

// ===== Processamento de único ZIP com contexto =====
async function handleZipFile(file, { append = undefined } = {}) {
  const key = fileKey(file);
  if (isDuplicateCall(key)) return;

  // Decide append automaticamente se não foi especificado
  try {
    const hasContent = results && results.children && results.children.length > 0;
    if (append === undefined) append = hasContent;
  } catch (e) { append = !!append; }

  // Evita corrida dentro da própria função
  if (handleZipFile.__running) return;
  handleZipFile.__running = true;

  // Cria o pacote/ctx
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

    // Cria container do pacote (e limpa tudo se não for append)
    if (!append) {
      results.innerHTML = "";
    }
    const ui = createPackageContainer(file.name);
    pkg.container = ui.container;
    pkg.contentEl = ui.content;
    pkg.downloadBtn = ui.downloadBtn;

    // Ativa esse pacote como atual
    window.__cpiPackages.push(pkg);
    setActivePackage(pkg.id);

    // Header clica -> ativa contexto
    ui.header.addEventListener('click', () => setActivePackage(pkg.id));

    // Botão Baixar por pacote
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

    // Decodifica e monta as seções DENTRO do container do pacote
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

    // Bind local: clicks em itens de iFlow/recursos abrem com o contexto correto
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

// ===== Múltiplos ZIPs, sequência, com contexto =====
async function handleZipFileMultiple(fileList) {
  for (const file of fileList) {
    await handleZipFile(file, { append: true });
  }
}

// ====== Versões com contexto das funções de exibição/abertura ======

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

// ===== Mantém compatibilidade das funções "globais" =====
function openResourceInMonaco(resourceId, resourceName, resourceType) {
  const pkg = window.__cpiPackages.find(p => p.id === window.__cpiActivePkgId);
  if (pkg) return openResourceInMonacoWithContext(resourceId, resourceName, resourceType, pkg);

  // Fallback antigo
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
  modal.querySelector(".modal-content").classList.add("show");
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

  // Fallback antigo
  const content = getFileContent(filePath);
  if (!content) { alert(t("file_not_found") + filePath); return; }
  modalTitle.textContent = `📄 ${filePath}`;
  modal.style.display = "block";
  modal.classList.add("show");
  modal.querySelector(".modal-content").classList.add("show");
  if (!monacoEditor) {
    require(["vs/editor/editor.main"], function () {
      initializeMonacoEditor(content, filePath);
    });
  } else {
    loadContentIntoMonaco(content, filePath);
  }
}

// Redirecionadores de compatibilidade
function processFile(fileName, content) {
  const pkg = window.__cpiPackages.find(p => p.id === window.__cpiActivePkgId);
  if (pkg) return processFileWithContext(fileName, content, pkg);
  // fallback antigo
  const resultDiv = document.createElement("div");
  resultDiv.className = "result-section";
  let processedContent = "";
  let title = "";
  try {
    if (fileName === "contentmetadata.md") {
      title = t("content_metadata_title");
      const decoded = atob(content.trim());
      processedContent = `<div class="code-block">${escapeHtml(decoded)}</div>`;
    } else if (fileName === "resources.cnt") {
      title = t("package_resources_title");
      const decoded = atob(content.trim());
      const jsonData = JSON.parse(decoded);
      resourcesCntDecoded = JSON.stringify(jsonData, null, 2);
      processedContent = `<div class="json-viewer">${formatPackageInfo(jsonData)}</div>`;
    }
    if (title) {
      resultDiv.innerHTML = `<div class="result-title">${title}</div>${processedContent}`;
      results.appendChild(resultDiv);
    }
  } catch (error) {
    resultDiv.innerHTML = `<div class="result-title error">${t("processing_error_title")}${fileName}</div>` +
      `<div class="error">${t("error_label")}${error.message}</div>` +
      `<div class="code-block">${escapeHtml(String(content).substring(0, 500))}...</div>`;
    results.appendChild(resultDiv);
  }
}

function displayIflowFileList() {
  const pkg = window.__cpiPackages.find(p => p.id === window.__cpiActivePkgId);
  if (pkg) return displayIflowFileListForContext(pkg);

  const files = Object.keys(fileContents).filter((name) => !name.endsWith("/"));
  if (files.length === 0) return;
  const resultDiv = document.createElement("div");
  resultDiv.className = "result-section";
  let html = `<div class="result-title">${t("iflow_files_title")}</div>`;
  html += '<ul class="script-list">';
  files.forEach((fn) => {
    const displayName = fn.split("/").pop();
    html += `<li class="script-item" data-file-path="${fn}">` +
            `<div class="script-name">${displayName}</div>` +
            `<div class="script-type">${fn}</div>` +
            `</li>`;
  });
  html += '</ul>';
  html += `<p style="margin-top: 15px; color: #666; font-style: italic;">${t("file_click_hint")}</p>`;
  resultDiv.innerHTML = html;
  results.appendChild(resultDiv);
}

// ======= Funções utilitárias =======
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

// ====== Download por pacote ======
function downloadResourcesForPackage(pkg) {
  const outZip = new JSZip();
  const tasks = [];

  // Usa resources.cnt decodificado (se existir) para nomear/extensões melhor
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
    // fallback: exporta tudo que tiver *_content
    Object.keys(pkg.fileContents).forEach((k) => {
      if (!k.endsWith("_content")) return;
      outZip.file(k.replace(/[\s/\\?%*:|"<>]/g, "_"), pkg.fileContents[k]);
    });
  }

  // Inclui metadados decodificados, se existirem
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

// ====== Refresh global (limpa tudo) ======
function globalRefresh() {
  // Limpa UI
  if (typeof results !== "undefined" && results) {
    results.innerHTML = "";
  }
  // Zera contexto
  window.__cpiPackages = [];
  window.__cpiActivePkgId = null;
  try { fileContents = {}; } catch(e){}
  try { resourcesCntDecoded = ""; } catch(e){}

  // Esconde seção de download se existir
  const downloadSection = document.getElementById("downloadSection");
  if (downloadSection) downloadSection.style.display = "none";
}

// Listener do botão Refresh (com fusível)
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("refreshBtn");
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = "1";
    btn.addEventListener("click", globalRefresh);
  }
});
