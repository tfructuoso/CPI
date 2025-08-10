
// === Global Endpoints Report (todos os pacotes) — v2 robust ===
(function () {
  function log(...args){ try { console.log('[GlobalReport]', ...args); } catch(e){} }
  function alertErr(msg){ try { alert(msg); } catch(e){} }

  function safeVal(v) { return (v == null ? '' : String(v)); }
  function cleanVal(v) {
    const s = safeVal(v).trim();
    if (['None','Not Applicable','N/A'].includes(s)) return '';
    return s;
  }

  async function parseWithBpmnJS(iflowZipContent) {
    const BpmnJS = window.BpmnJS;
    const JSZip = window.JSZip;
    if (!BpmnJS || !JSZip) return null;

    let iflowXml = "";
    try {
      const zip = await new JSZip().loadAsync(iflowZipContent);
      const xmlFile = Object.values(zip.files).find(
        (file) => !file.dir && /\.(iflw|bpmn|xml)$/i.test(file.name)
      );
      if (!xmlFile) return [];
      iflowXml = await xmlFile.async("string");
    } catch (e) {
      if (typeof iflowZipContent === "string" && iflowZipContent.trim().startsWith("<")) {
        iflowXml = iflowZipContent;
      } else {
        log("Erro ao abrir ZIP do iFlow:", e);
        return [];
      }
    }

    const bpmnViewer = new BpmnJS();
    try {
      await bpmnViewer.importXML(iflowXml);
      const elementRegistry = bpmnViewer.get("elementRegistry");
      const participantElements = elementRegistry.filter(
        (el) => el.type === "bpmn:Participant" && !el.businessObject.processRef
      );
      const rows = [];

      participantElements.forEach((p) => {
        const out = {
          participant: p.businessObject.name || p.id,
          role: "Indefinido",
          protocol: "",
          address: "",
          description: "",
          operation: "",
          entidadeOdata: "",
          queryOptions: "",
          customQueryOptions: ""
        };

        if (p.incoming?.length > 0) out.role = "Receiver";
        if (p.outgoing?.length > 0) out.role = "Sender";

        const mf = p.incoming?.[0] || p.outgoing?.[0];
        if (mf?.businessObject?.extensionElements?.values) {
          const props = mf.businessObject.extensionElements.values;
          let messageProtocol="", transportProtocol="", componentType="";
          let addressParticipant="", httpAddrParticipant="";
          let urlPath="", queueNameOutbound="", kafkaTopic="";
          let operationRaw="", description="";
          let resourcePath="", queryOptions="", customQueryOptions="", fields="";

          for (const prop of props) {
            let key, value;
            if (prop.$children) {
              const k = prop.$children.find(c=>c.$type==='key');
              const v = prop.$children.find(c=>c.$type==='value');
              key = k && (k.$body ?? k.body);
              value = v && (v.$body ?? v.body);
            } else {
              key = prop.key || prop.name;
              value = prop.value || prop.body;
            }
            if (!key) continue;
            key = String(key);
            value = value != null ? String(value) : "";

            if (key === "MessageProtocol") messageProtocol = value;
            else if (key === "TransportProtocol") transportProtocol = value;
            else if (key === "ComponentType") componentType = value;
            else if (key.toLowerCase() === "address") addressParticipant = value;
            else if (key === "httpAddressWithoutQuery") httpAddrParticipant = value;
            else if (key === "urlPath") urlPath = value;
            else if (key === "QueueName_outbound") queueNameOutbound = value;
            else if (key === "topic") kafkaTopic = value;
            else if (key.toLowerCase() === "operation") operationRaw = value;
            else if (key === "Description") description = value;
            else if (key === "resourcePath") resourcePath = value;
            else if (key === "queryOptions") queryOptions = value;
            else if (key === "customQueryOptions") customQueryOptions = value;
            else if (key === "fields") fields = value;
          }

          out.protocol = cleanVal(messageProtocol) || cleanVal(transportProtocol) || cleanVal(componentType);

          if (cleanVal(componentType) === "HTTPS" && cleanVal(urlPath)) out.address = urlPath;
          else if (cleanVal(componentType) === "JMS" && cleanVal(queueNameOutbound)) out.address = queueNameOutbound;
          else if (cleanVal(componentType) === "Kafka" && cleanVal(kafkaTopic)) out.address = kafkaTopic;
          else if (cleanVal(addressParticipant)) out.address = addressParticipant;
          else if (cleanVal(httpAddrParticipant)) out.address = httpAddrParticipant;

          if (operationRaw) {
            const m = operationRaw.match(/\(([^)]+)\)/);
            out.operation = m ? m[1] : operationRaw;
          }

          out.description = cleanVal(description);
          out.entidadeOdata = cleanVal(resourcePath);
          out.queryOptions = cleanVal(queryOptions) || cleanVal(fields);
          out.customQueryOptions = cleanVal(customQueryOptions);

          rows.push(out);
        }
      });

      return rows;
    } catch (err) {
      log("Erro BPMN:", err);
      return [];
    } finally {
      try { bpmnViewer.destroy(); } catch(e){}
    }
  }

  async function extractDetails(iflowContent) {
    // Primeiro tenta com BpmnJS
    const a = await parseWithBpmnJS(iflowContent);
    if (a != null) return a;

    // Fallback: usar a função global já existente no app (editor.js)
    if (typeof window.extractIFlowEndpoints === 'function') {
      try {
        const list = await window.extractIFlowEndpoints(iflowContent);
        // Normaliza campos do fallback
        return (list || []).map(ep => ({
          participant: ep.name || "",
          role: ep.role || "",
          protocol: ep.protocol || "",
          address: ep.address || "",
          description: ep.description || "",
          operation: ep.operation || "",
          entidadeOdata: ep.entidadeOdata || "",
          queryOptions: ep.queryOptions || "",
          customQueryOptions: ep.customQueryOptions || ""
        }));
      } catch (e) {
        log("Falha no fallback extractIFlowEndpoints:", e);
      }
    }
    return [];
  }

  async function exportAllPackagesEndpointsReport() {
    try {
      const pkgs = (window.__cpiPackages || []).slice();
      if (!pkgs.length) {
        alertErr("Nenhum pacote carregado para exportar.");
        return;
      }
      if (typeof XLSX === 'undefined') {
        alertErr("Biblioteca XLSX não carregada. Verifique a ordem dos scripts no index.html.");
        return;
      }

      const rows = [];
      rows.push([
        "Package",
        "iFlow",
        "Participant",
        "Role",
        "Protocol/Adapter",
        "Description",
        "Operation",
        "Address",
        "entidadeOdata",
        "queryOptions",
        "customQueryOptions"
      ]);

      for (const pkg of pkgs) {
        let packageInfo = null;
        if (pkg.resourcesCntDecoded) {
          try { packageInfo = JSON.parse(pkg.resourcesCntDecoded); } catch (e) { log("JSON resourcesCntDecoded inválido", e); }
        }

        if (!packageInfo || !Array.isArray(packageInfo.resources)) {
          const names = Object.keys(pkg.fileContents).filter(k => k.endsWith('_content'));
          for (const name of names) {
            const endpoints = await extractDetails(pkg.fileContents[name]);
            const iflowDisplay = name.replace(/_content$/, '');
            endpoints.forEach(ep => {
              rows.push([
                pkg.name, iflowDisplay, ep.participant, ep.role, ep.protocol,
                ep.description, ep.operation, ep.address,
                ep.entidadeOdata, ep.queryOptions, ep.customQueryOptions
              ]);
            });
          }
          continue;
        }

        const artifacts = packageInfo.resources.filter(r => r.resourceType === "IFlow");
        for (const iflow of artifacts) {
          const content = pkg.fileContents[iflow.id + "_content"];
          if (!content) continue;
          const endpoints = await extractDetails(content);
          endpoints.forEach(ep => {
            rows.push([
              pkg.name, (iflow.displayName || iflow.name || iflow.id),
              ep.participant, ep.role, ep.protocol,
              ep.description, ep.operation, ep.address,
              ep.entidadeOdata, ep.queryOptions, ep.customQueryOptions
            ]);
          });
        }
      }

      if (rows.length === 1) {
        alertErr("Nenhum endpoint encontrado nos pacotes carregados.");
        return;
      }

      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Endpoints - Geral");
      XLSX.writeFile(wb, "endpoints_iflow_all.xlsx");
      log("Relatório geral gerado com", rows.length-1, "linhas.");
    } catch (e) {
      console.error("Falha ao gerar relatório geral:", e);
      alertErr("Falha ao gerar relatório geral. Abra o console (F12) para detalhes.");
    }
  }

  // Expõe globalmente
  window.exportAllPackagesEndpointsReport = exportAllPackagesEndpointsReport;
  window.gerarRelatorioGeralTodosPacotes = exportAllPackagesEndpointsReport;

  // Garante o botão e o binding
  function ensureButton() {
    const host = document.getElementById('downloadSection') || document.body;
    if (host.id === 'downloadSection') host.style.display = 'block';
    let btn = document.getElementById('btnGlobalReport');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'btnGlobalReport';
      btn.className = 'download-btn';
      btn.title = 'Exporta um relatório com endpoints de todos os pacotes';
      btn.textContent = '📊 Relatório Geral (Excel)';
      host.appendChild(btn);
    }
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', exportAllPackagesEndpointsReport);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureButton);
  } else {
    ensureButton();
  }
})();
