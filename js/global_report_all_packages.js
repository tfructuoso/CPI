// === Global Endpoints Report (todos os pacotes) — v3.3 (resources.cnt + parameters.prop dentro do iFlow) ===
(function () {
  function log(...args){ try { console.log('[GlobalReport]', ...args); } catch(e){} }
  function alertErr(msg){ try { alert(msg); } catch(e){} }

  function safeVal(v){ return (v == null ? '' : String(v)); }
  function cleanVal(v){ const s = safeVal(v).trim(); return (['None','Not Applicable','N/A'].includes(s) ? '' : s); }

  // --- util decode
  function decodeToString(x){
    if (typeof x === 'string') return x;
    try { return new TextDecoder().decode(x); } catch(e){ try { return String(x); } catch(e2){ return ''; } }
  }

  // --- parser simples de .properties (somente "chave=valor" e ignora comentários)
  function parseProps(text){
    const map = {};
    if (!text) return map;
    const s = String(text);
    s.split(/\r?\n/).forEach(line => {
      const ln = line.trim();
      if (!ln || ln.startsWith('#') || ln.startsWith(';')) return;
      const i = ln.indexOf('=');
      if (i < 0) return;
      let k = ln.slice(0, i).trim();
      const v = ln.slice(i+1).trim();
      // remove BOM se houver
      if (k && k.charCodeAt(0) === 0xFEFF) k = k.slice(1);
      if (k) map[k] = v;
    });
    return map;
  }

  // --- carrega parameters.prop de QUALQUER pasta do ZIP do pacote (ex.: src/main/resources/parameters.prop) — opcional
  function loadRootParams(pkg){
    if (pkg.__rootParams) return pkg.__rootParams;

    // tenta alguns nomes prováveis
    let entryName = null;
    const candidates = Object.keys(pkg.fileContents).filter(fn => /(^|\/)parameters\.prop$/i.test(fn));
    if (candidates.length) entryName = candidates[0];

    if (!entryName){ pkg.__rootParams = {}; return pkg.__rootParams; }

    const raw = pkg.fileContents[entryName];
    const txt = decodeToString(raw);
    const map = parseProps(txt);
    pkg.__rootParams = map;
    log('[Params-pacote]', 'pkg=', pkg.name, 'file=', entryName, 'keys=', Object.keys(map));
    return map;
  }

  // --- carrega parâmetros de DENTRO do ZIP do iFlow (<iflow>_content)
  async function loadIflowParams(pkg, iflowKey){
    if (!iflowKey) return {};
    const JSZip = window.JSZip;
    if (!JSZip) return {};

    // cache por iflow
    if (!pkg.__iflowParams) pkg.__iflowParams = {};
    if (pkg.__iflowParams[iflowKey]) return pkg.__iflowParams[iflowKey];

    // tenta localizar o conteúdo do iFlow: preferir "<id>_content", mas aceita nome base usado no fallback
    let content = pkg.fileContents[iflowKey + '_content'];
    if (!content && pkg.fileContents[iflowKey]) content = pkg.fileContents[iflowKey]; // caso já venha sem sufixo
    if (!content){
      // tenta descobrir algum *_content cujo nome base coincida
      const cand = Object.keys(pkg.fileContents).find(k => k.endsWith('_content') && k.replace(/_content$/,'') === iflowKey);
      if (cand) content = pkg.fileContents[cand];
    }
    if (!content) return (pkg.__iflowParams[iflowKey] = {});

    let zip;
    try {
      zip = await new JSZip().loadAsync(content);
    } catch (e){
      // se não for zip, não há props internas
      return (pkg.__iflowParams[iflowKey] = {});
    }

    const merged = {};
    const files = Object.values(zip.files);
    const hitNames = [];

    // Procura por parameters.prop OU *.properties em QUALQUER PASTA do iFlow (ex.: src/main/resources/parameters.prop)
    for (const f of files){
      if (f.dir) continue;
      if (!/(^|\/)parameters\.prop$/i.test(f.name) && !/\.properties$/i.test(f.name)) continue;

      try {
        const txt = await zip.file(f.name).async('string');
        const m = parseProps(txt);
        Object.assign(merged, m);
        hitNames.push(f.name + ' (' + Object.keys(m).length + ' chaves)');
      } catch(e){}
    }

    if (hitNames.length){
      log('[Params-iflow]', 'pkg=', pkg.name, 'iflowKey=', iflowKey, 'files=', hitNames);
    }
    return (pkg.__iflowParams[iflowKey] = merged);
  }

  // --- junta params do pacote + do iFlow (iFlow sobrescreve pacote)
  async function getMergedParamsForIflow(pkg, iflowIdOrName){
    const root = loadRootParams(pkg);
    const inner = await loadIflowParams(pkg, iflowIdOrName);
    return Object.assign({}, root, inner);
  }

  // --- substitui {{CHAVE}} usando o mapa (exata; mantém se não achar)
  function resolvePlaceholders(addr, params){
    if (!addr) return addr;
    if (!params) return addr;
    return String(addr).replace(/\{\{([^}]+)\}\}/g, (m, p1) => {
      const key = String(p1).trim();
      if (Object.prototype.hasOwnProperty.call(params, key)) return params[key];
      return m; // não achou → mantém
    });
  }

  // --- BPMN parse (igual base anterior)
  async function parseWithBpmnJS(iflowZipContent){
    const BpmnJS = window.BpmnJS, JSZip = window.JSZip;
    if (!BpmnJS || !JSZip) return null;

    let iflowXml = '';
    try {
      const zip = await new JSZip().loadAsync(iflowZipContent);
      const xmlFile = Object.values(zip.files).find(f => !f.dir && /\.(iflw|bpmn|xml)$/i.test(f.name));
      if (!xmlFile) return [];
      iflowXml = await xmlFile.async('string');
    } catch (e){
      if (typeof iflowZipContent === 'string' && iflowZipContent.trim().startsWith('<')){
        iflowXml = iflowZipContent;
      } else {
        log('Erro ao abrir ZIP do iFlow:', e);
        return [];
      }
    }

    const bpmnViewer = new BpmnJS();
    try {
      await bpmnViewer.importXML(iflowXml);
      const elementRegistry = bpmnViewer.get('elementRegistry');
      const participantElements = elementRegistry.filter(el => el.type === 'bpmn:Participant' && !el.businessObject.processRef);
      const rows = [];

      participantElements.forEach((p) => {
        const out = {
          participant: p.businessObject.name || p.id,
          role: 'Indefinido',
          protocol: '',
          address: '',
          description: '',
          operation: '',
          entidadeOdata: '',
          queryOptions: '',
          customQueryOptions: ''
        };

        if (p.incoming?.length > 0) out.role = 'Receiver';
        if (p.outgoing?.length > 0) out.role = 'Sender';

        const mf = p.incoming?.[0] || p.outgoing?.[0];
        if (mf?.businessObject?.extensionElements?.values) {
          const props = mf.businessObject.extensionElements.values;
          let messageProtocol='', transportProtocol='', componentType='';
          let addressParticipant='', httpAddrParticipant='';
          let urlPath='', queueNameOutbound='', kafkaTopic='';
          let operationRaw='', description='';
          let resourcePath='', queryOptions='', customQueryOptions='', fields='';

          for (const prop of props){
            let key, value;
            if (prop.$children){
              const k = prop.$children.find(c => c.$type === 'key');
              const v = prop.$children.find(c => c.$type === 'value');
              key = k && (k.$body ?? k.body);
              value = v && (v.$body ?? v.body);
            } else {
              key = prop.key || prop.name;
              value = prop.value || prop.body;
            }
            if (!key) continue;
            key = String(key);
            value = value != null ? String(value) : '';

            if (key === 'MessageProtocol') messageProtocol = value;
            else if (key === 'TransportProtocol') transportProtocol = value;
            else if (key === 'ComponentType') componentType = value;
            else if (key.toLowerCase() === 'address') addressParticipant = value;
            else if (key === 'httpAddressWithoutQuery') httpAddrParticipant = value;
            else if (key === 'urlPath') urlPath = value;
            else if (key === 'QueueName_outbound') queueNameOutbound = value;
            else if (key === 'topic') kafkaTopic = value;
            else if (key.toLowerCase() === 'operation') operationRaw = value;
            else if (key === 'Description') description = value;
            else if (key === 'resourcePath') resourcePath = value;
            else if (key === 'queryOptions') queryOptions = value;
            else if (key === 'customQueryOptions') customQueryOptions = value;
            else if (key === 'fields') fields = value;
          }

          out.protocol = cleanVal(messageProtocol) || cleanVal(transportProtocol) || cleanVal(componentType);

          if (cleanVal(componentType) === 'HTTPS' && cleanVal(urlPath)) out.address = urlPath;
          else if (cleanVal(componentType) === 'JMS' && cleanVal(queueNameOutbound)) out.address = queueNameOutbound;
          else if (cleanVal(componentType) === 'Kafka' && cleanVal(kafkaTopic)) out.address = kafkaTopic;
          else if (cleanVal(addressParticipant)) out.address = addressParticipant;
          else if (cleanVal(httpAddrParticipant)) out.address = httpAddrParticipant;

          if (operationRaw){
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
    } catch (err){
      log('Erro BPMN:', err);
      return [];
    } finally {
      try { bpmnViewer.destroy(); } catch(e){}
    }
  }

  async function extractDetails(iflowContent){
    const a = await parseWithBpmnJS(iflowContent);
    if (a != null) return a;

    if (typeof window.extractIFlowEndpoints === 'function'){
      try {
        const list = await window.extractIFlowEndpoints(iflowContent);
        return (list || []).map(ep => ({
          participant: ep.name || '',
          role: ep.role || '',
          protocol: ep.protocol || '',
          address: ep.address || '',
          description: ep.description || '',
          operation: ep.operation || '',
          entidadeOdata: ep.entidadeOdata || '',
          queryOptions: ep.queryOptions || '',
          customQueryOptions: ep.customQueryOptions || ''
        }));
      } catch(e){
        log('Falha no fallback extractIFlowEndpoints:', e);
      }
    }
    return [];
  }

  async function exportAllPackagesEndpointsReport(){
    try {
      const pkgs = (window.__cpiPackages || []).slice();
      if (!pkgs.length){ alertErr('Nenhum pacote carregado para exportar.'); return; }
      if (typeof XLSX === 'undefined'){ alertErr('Biblioteca XLSX não carregada.'); return; }

      const rows = [];
      rows.push([
        'Package','iFlow','Participant','Role','Protocol/Adapter',
        'Description','Operation','Address','entidadeOdata','queryOptions','customQueryOptions'
      ]);

      for (const pkg of pkgs){
        const rootParams = loadRootParams(pkg);

        let packageInfo = null;
        if (pkg.resourcesCntDecoded){
          try { packageInfo = JSON.parse(pkg.resourcesCntDecoded); } catch(e){ log('resourcesCntDecoded inválido', e); }
        }

        if (!packageInfo || !Array.isArray(packageInfo.resources)){
          // fallback: todos *_content
          const names = Object.keys(pkg.fileContents).filter(k => k.endsWith('_content'));
          for (const name of names){
            const endpoints = await extractDetails(pkg.fileContents[name]);
            const iflowDisplay = name.replace(/_content$/, '');
            // merge params: pacote + params internos do iFlow (pelo nome base)
            const mergedParams = Object.assign({}, rootParams, await loadIflowParams(pkg, iflowDisplay));
            endpoints.forEach(ep => {
              const addrResolved = resolvePlaceholders(ep.address, mergedParams);
              rows.push([
                pkg.name, iflowDisplay, ep.participant, ep.role, ep.protocol,
                ep.description, ep.operation, addrResolved,
                ep.entidadeOdata, ep.queryOptions, ep.customQueryOptions
              ]);
            });
          }
          continue;
        }

        // caminho principal: via resources.cnt
        const artifacts = packageInfo.resources.filter(r => r.resourceType === 'IFlow');
        for (const iflow of artifacts){
          const content = pkg.fileContents[iflow.id + '_content'];
          if (!content) continue;

          const endpoints = await extractDetails(content);
          // merge params: pacote + params internos do iFlow (pelo id) + (fallback pelo displayName, se quiser)
          const mergedParams = Object.assign({}, rootParams, await loadIflowParams(pkg, iflow.id));
          // Se quiser tentar também pelo displayName:
          if (iflow.displayName) Object.assign(mergedParams, await loadIflowParams(pkg, iflow.displayName));

          endpoints.forEach(ep => {
            const addrResolved = resolvePlaceholders(ep.address, mergedParams);
            rows.push([
              pkg.name, (iflow.displayName || iflow.name || iflow.id),
              ep.participant, ep.role, ep.protocol,
              ep.description, ep.operation, addrResolved,
              ep.entidadeOdata, ep.queryOptions, ep.customQueryOptions
            ]);
          });
        }
      }

      if (rows.length === 1){ alertErr('Nenhum endpoint encontrado.'); return; }

      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Endpoints - Geral');
      XLSX.writeFile(wb, 'endpoints_iflow_all.xlsx');
      log('Relatório geral gerado com', rows.length - 1, 'linhas.');
    } catch (e){
      console.error('Falha ao gerar relatório geral:', e);
      alertErr('Falha ao gerar relatório geral. Abra o console (F12) para detalhes.');
    }
  }

  // expõe global
  window.exportAllPackagesEndpointsReport = exportAllPackagesEndpointsReport;
  window.gerarRelatorioGeralTodosPacotes = exportAllPackagesEndpointsReport;

  // botão
  function ensureButton(){
    const host = document.getElementById('downloadSection') || document.body;
    if (host.id === 'downloadSection') host.style.display = 'block';
    let btn = document.getElementById('btnGlobalReport');
    if (!btn){
      btn = document.createElement('button');
      btn.id = 'btnGlobalReport';
      btn.className = 'download-btn';
      btn.title = 'Exporta um relatório com endpoints de todos os pacotes';
      btn.textContent = '📊 Relatório Geral (Excel)';
      host.appendChild(btn);
    }
    if (!btn.dataset.bound){
      btn.dataset.bound = '1';
      btn.addEventListener('click', exportAllPackagesEndpointsReport);
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ensureButton);
  } else {
    ensureButton();
  }
})();
