function setStatus(msg){ document.getElementById('status').innerText = msg || ''; }
function parseProp(content){
  const map = {};
  content.split(/\r?\n/).forEach(line => {
    line = line.trim();
    if(!line || line.startsWith('#') || !line.includes('=')) return;
    const [k, v] = line.split('=', 2);
    map[k.trim()] = (v??'').trim();
  });
  return map;
}
function unescapeProp(val){
  if(typeof val !== 'string') return val;
  return val.replace(/\\:/g, ':').replace(/\\=/g,'=');
}
function resolvePlaceholdersExact(value, props){
  if(typeof value !== 'string') return value;
  const m = value.match(/^\{\{([\w.\-]+)\}\}$/);
  if(!m) return value;
  const key = m[1];
  if(Object.prototype.hasOwnProperty.call(props, key)){
    return unescapeProp(props[key]);
  }
  return value;
}
function textContent(node, selector){
  const el = node.querySelector(selector);
  return el ? (el.textContent || '').trim() : '';
}
async function loadZip(file){
  const jszip = new JSZip();
  return jszip.loadAsync(file);
}
function extractRowsFromXml(xmlText, fileLabel, props){
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, 'text/xml');
  const flows = Array.from(xml.getElementsByTagName('bpmn2:messageFlow'));
  const rows = [];
  for(const flow of flows){
    const extEls = flow.getElementsByTagName('bpmn2:extensionElements');
    if(!extEls || !extEls.length) continue;
    const propsNodes = extEls[0].getElementsByTagName('ifl:property');
    const found = {};
    for(const p of propsNodes){
      const k = textContent(p, 'key');
      const v = textContent(p, 'value');
      if(k) found[k] = v;
    }
    let tipo = found['direction'] || found['ComponentType'] || '';
    let adapter = found['Name'] || '';
    let url = found['topic'] || found['urlPath'] || found['address'] || '';
    let query = found['query'] || '';
    let operacao = found['operation'] || '';
    tipo = resolvePlaceholdersExact(tipo, props);
    adapter = resolvePlaceholdersExact(adapter, props);
    url = resolvePlaceholdersExact(url, props);
    query = resolvePlaceholdersExact(query, props);
    operacao = resolvePlaceholdersExact(operacao, props);
    rows.push({ Arquivo: fileLabel, Tipo: tipo, Adapter: adapter, URL: url, Query: query, Operacao: operacao });
  }
  return rows;
}
async function processPackage(zipFile, propMap){
  setStatus('Lendo pacote...');
  const zip = await loadZip(zipFile);
  const rows = [];
  const names = Object.keys(zip.files);
  for(const name of names){
    if(!name.toLowerCase().endsWith('.ifl')) continue;
    const file = zip.files[name];
    const xmlText = await file.async('string');
    const partRows = extractRowsFromXml(xmlText, name.split('/').pop(), propMap);
    rows.push(...partRows);
  }
  return rows;
}
function renderTable(rows){
  const table = document.getElementById('report');
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = '';
  for(const r of rows){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.Arquivo}</td><td>${r.Tipo}</td><td>${r.Adapter}</td><td>${r.URL}</td><td>${r.Query}</td><td>${r.Operacao}</td>`;
    tbody.appendChild(tr);
  }
  table.style.display = rows.length ? 'table' : 'none';
}
function exportExcel(rows){
  if(!rows.length){ alert('Nada para exportar.'); return; }
  const ws = XLSX.utils.json_to_sheet(rows.map(r => ({
    Arquivo: r.Arquivo, Tipo: r.Tipo, Adapter: r.Adapter, URL: r.URL, Query: r.Query, Operacao: r.Operacao
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Relatorio');
  XLSX.writeFile(wb, 'relatorio_messageflow.xlsx');
}
async function main(){
  const btn = document.getElementById('btnProcess');
  const btnExport = document.getElementById('btnExport');
  const inputZip = document.getElementById('zipFile');
  const inputProp = document.getElementById('propFile');
  let lastRows = [];
  btn.addEventListener('click', async () => {
    const zipFile = inputZip.files[0];
    if(!zipFile){ alert('Selecione o arquivo .zip do CPI.'); return; }
    let propMap = {};
    if(inputProp.files[0]){
      const text = await inputProp.files[0].text();
      propMap = parseProp(text);
    }
    try{
      btn.disabled = true; btnExport.disabled = true;
      setStatus('Processando .zip...');
      lastRows = await processPackage(zipFile, propMap);
      renderTable(lastRows);
      setStatus(lastRows.length ? `Processado: ${lastRows.length} linha(s).` : 'Nenhum messageFlow encontrado.');
      btnExport.disabled = !lastRows.length;
    }catch(err){
      console.error(err);
      setStatus('Erro ao processar pacote. Veja o console.');
    }finally{
      btn.disabled = false;
    }
  });
  btnExport.addEventListener('click', () => exportExcel(lastRows));
}
document.addEventListener('DOMContentLoaded', main);
