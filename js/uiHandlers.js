
// === uiHandlers.js (atualizado) ===

// Safe getters
const _uploadArea = document.getElementById("uploadArea");
const _fileInput  = document.getElementById("fileInput");
const _results    = document.getElementById("results");
const _refreshBtn = document.getElementById("refreshBtn");
const _langSelect = document.getElementById("langSelect");
const _languageSelect = document.getElementById("languageSelect");
const _fileSelect = document.getElementById("fileSelect");
const _copyBtn    = document.getElementById("copyBtn");
const _formatBtn  = document.getElementById("formatBtn");
const _fullscreenBtn = document.getElementById("fullscreenBtn");
const _viewSwitchBtn = document.getElementById("viewSwitchBtn");
const _closeModal = document.getElementById("closeModal");

function _exists(el){ return !!el; }

// Drag & drop visual
if (_exists(_uploadArea)) {
  _uploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    _uploadArea.classList.add("dragover");
  });

  _uploadArea.addEventListener("dragleave", () => {
    _uploadArea.classList.remove("dragover");
  });

  // Drop múltiplos ZIPs
  const stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
  ["dragenter","dragover","dragleave","drop"].forEach(evt =>
    _uploadArea.addEventListener(evt, stop, false)
  );

  _uploadArea.addEventListener("drop", (e) => {
    _uploadArea.classList.remove("dragover");
    const files = Array.from(e.dataTransfer.files).filter(f => /\.zip$/i.test(f.name));
    if (!files.length) return;

    const multi = files.length > 1;
    files.forEach(f => enqueueZip(f, { append: true, expand: false }));
  });
}

// File picker múltiplo
if (_exists(_fileInput) && !_fileInput.dataset.bound) {
  _fileInput.dataset.bound = "1";
  _fileInput.addEventListener("change", (e) => {
    const files = Array.from(e.target.files).filter(f => /\.zip$/i.test(f.name));
    if (!files.length) return;

    const multi = files.length > 1;
    files.forEach(f => enqueueZip(f, { append: true, expand: false }));

    // limpa pra permitir re-selecionar iguais depois
    _fileInput.value = "";
  });
}

// Modal & Monaco
if (_exists(_closeModal)) {
  _closeModal.addEventListener("click", closeEditorModal);
}

if (_exists(_viewSwitchBtn)) {
  _viewSwitchBtn.addEventListener("click", toggleViewMode);
}

if (_exists(_languageSelect)) {
  _languageSelect.addEventListener("change", (e) => {
    if (monacoEditor) {
      monaco.editor.setModelLanguage(monacoEditor.getModel(), e.target.value);
    }
  });
}

if (_exists(_fileSelect)) {
  _fileSelect.addEventListener("change", (e) => {
    const fileName = e.target.value;
    if (currentFiles[fileName]) {
      setEditorContent(currentFiles[fileName], fileName);
    }
  });
}

if (_exists(_copyBtn)) {
  _copyBtn.addEventListener("click", () => {
    if (!monacoEditor) return;
    const content = monacoEditor.getValue();
    navigator.clipboard.writeText(content).then(() => {
      _copyBtn.textContent = "✅";
      setTimeout(() => (_copyBtn.textContent = "📋"), 2000);
    }).catch(() => {
      const textArea = document.createElement("textarea");
      textArea.value = content;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      _copyBtn.textContent = "✅";
      setTimeout(() => (_copyBtn.textContent = "📋"), 2000);
    });
  });
}

if (_exists(_formatBtn)) {
  _formatBtn.addEventListener("click", () => {
    if (!monacoEditor) return;
    const model = monacoEditor.getModel();
    const language = model ? model.getLanguageId() : "";
    if (language === "xml") {
      const formatted = prettyPrintXML(monacoEditor.getValue());
      monacoEditor.setValue(formatted);
    } else {
      const action = monacoEditor.getAction("editor.action.formatDocument");
      if (action) action.run();
    }
  });
}

if (_exists(_fullscreenBtn)) {
  _fullscreenBtn.addEventListener("click", toggleFullscreen);
}

// Refresh global (usa função do fileLoader)
if (_exists(_refreshBtn) && !_refreshBtn.dataset.bound) {
  _refreshBtn.dataset.bound = "1";
  _refreshBtn.addEventListener("click", () => {
    if (typeof globalRefresh === "function") {
      globalRefresh();
    } else {
      // fallback
      location.reload();
    }
  });
}

// Tecla ESC fecha modal
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal.style.display === "block") {
    closeEditorModal();
  }
});

// Clique em listas (abre recurso ou arquivo dentro do contexto do pacote ativo)
// OBS: nos loaders mais novos, cada pacote já tem seu próprio listener local.
// Este aqui continua por compatibilidade.
if (_exists(_results)) {
  _results.addEventListener("click", function (e) {
    const scriptItem = e.target.closest(".script-item");
    if (!scriptItem) return;

    if (scriptItem.dataset.resourceId) {
      const resourceId = scriptItem.dataset.resourceId;
      const resourceName = scriptItem.querySelector(".script-name").textContent;
      const resourceType = scriptItem.dataset.resourceType;
      const resourceUrl = scriptItem.dataset.resourceUrl;

      if (resourceType && resourceType.toUpperCase() === "URL" && resourceUrl) {
        window.open(resourceUrl, "_blank");
        return;
      }

      if (resourceType && resourceType.toUpperCase() === "FILE") {
        downloadFileResource(resourceId, resourceName, resourceType);
        return;
      }

      openResourceInMonaco(resourceId, resourceName, resourceType);
    } else if (scriptItem.dataset.filePath) {
      const filePath = scriptItem.dataset.filePath;
      openIflowFile(filePath);
    }
  });
}

// Idioma
if (_exists(_langSelect)) {
  _langSelect.addEventListener("change", (e) => {
    setLanguage(e.target.value);
  });
}
