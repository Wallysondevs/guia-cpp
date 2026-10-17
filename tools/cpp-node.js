/* Roda no Node o MESMO assets/cpp/cpp-worker.js do navegador (Clang 22 em
   WebAssembly + o mesmo sysroot e o mesmo executor de programas), num
   worker_thread. Não precisa de npm install: usa só os arquivos de assets/cpp/.

   const C = require("./cpp-node.js");
   const r = await C.executar([{nome: "programa.cpp", codigo}], {flags, args, stdin});
   r = { compilou, exitCompilacao, diag (com cores ANSI), diagTexto, msCompilacao, pch,
         saida (stdout+stderr do programa, na ordem), err, eventos: [{t:"out"|"err"|"eco", s}],
         exit, sinal, leuSemEntrada, estourou, tempoEsgotado } */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { Worker } = require("worker_threads");
const { pathToFileURL } = require("url");

const ASSETS = path.join(__dirname, "../assets/cpp");
const WORKER_JS = path.join(ASSETS, "cpp-worker.js");
const TEMPO_MAX = 15000; // ms rodando (igual ao navegador)
require("v8").setFlagsFromString("--expose-gc");

// Código que roda dentro do worker_thread: imita o ambiente de um Web Worker.
const BOOT = `
const { parentPort, workerData } = require("worker_threads");
const fs = require("fs"), zlib = require("zlib");
const { fileURLToPath } = require("url");
globalThis.self = globalThis;
self.location = { href: workerData.url };
// cada compilação cria 3 instâncias do Clang (memórias de centenas de MB):
// libera logo, para não acumular quando vários autores testam ao mesmo tempo
const coletar = globalThis.gc;
globalThis.postMessage = (m, t) => { parentPort.postMessage(m, t); if (coletar && m && (m.ev === "fim" || m.ev === "compilado")) setTimeout(coletar, 0); };
parentPort.on("message", (m) => { if (self.onmessage) self.onmessage({ data: m }); });
globalThis.fetch = async (u) => {
  const arq = fileURLToPath(String(u));
  if (!fs.existsSync(arq)) return new Response(null, { status: 404 });
  const b = fs.readFileSync(arq);
  return new Response(b, { status: 200, headers: { "content-length": String(b.length) } });
};
require(workerData.arquivo);
`;

let worker = null, pronto = null, recursos = null, seq = 0;
const ouvintes = new Map();

function iniciar() {
  if (pronto) return pronto;
  if (!fs.existsSync(WORKER_JS)) { console.error("Falta assets/cpp/cpp-worker.js (rode: cd tools && npm install && node construir-cpp.mjs)"); process.exit(3); }
  pronto = new Promise((ok, falha) => {
    worker = new Worker(BOOT, { eval: true, resourceLimits: { maxOldGenerationSizeMb: 1024 }, workerData: { url: pathToFileURL(WORKER_JS).href, arquivo: WORKER_JS } });
    worker.unref();
    worker.on("message", (m) => {
      if (m.ev === "progresso") return;
      if (m.ev === "pronto") { if (m.recursos) recursos = m.recursos; ok(); return; }
      if (m.ev === "falha" && !m.id) { falha(new Error(m.msg)); return; }
      const f = ouvintes.get(m.id);
      if (f) f(m);
      else if (m.ev === "falha") console.error("cpp-node:", m.msg);
    });
    worker.on("error", (e) => { falha(e); for (const f of ouvintes.values()) f({ ev: "falha", msg: String(e && e.stack || e) }); });
    worker.postMessage({ op: "carregar", recursos });
  });
  return pronto;
}
function encerrar() {
  if (worker) worker.terminate();
  worker = null; pronto = null;
  const os = Array.from(ouvintes.values()); ouvintes.clear();
  os.forEach((f) => { try { f({ ev: "morto" }); } catch (e) { /* ok */ } });
}

/**
 * arquivos: [{nome, codigo}] (todos os .cpp são compilados juntos; o 1º dá nome ao programa)
 * opts: { flags: [...]|null, args: [...], stdin: string|null, semPch, tempoMax }
 */
async function executar(arquivos, opts) {
  opts = opts || {};
  await iniciar();
  const id = ++seq;
  const nome = (arquivos[0] && arquivos[0].nome || "programa.cpp").replace(/\.[^.]*$/, "").replace(/^.*\//, "") || "programa";
  const dec = { out: new TextDecoder(), err: new TextDecoder() };
  const r = { compilou: false, diag: "", saida: "", err: "", eventos: [], exit: null, sinal: null, nome };
  return new Promise((ok, falha) => {
    let relogio = null;
    const fim = () => { clearTimeout(relogio); ouvintes.delete(id); ok(r); };
    ouvintes.set(id, (m) => {
      if (m.ev === "compilado") {
        r.compilou = m.ok; r.exitCompilacao = m.exit; r.diag = m.diag; r.diagTexto = m.diag.replace(/\x1b\[[0-9;]*m/g, ""); r.msCompilacao = m.ms; r.pch = m.pch;
        if (m.ok) relogio = setTimeout(() => { r.tempoEsgotado = true; encerrar(); }, opts.tempoMax || TEMPO_MAX);
      } else if (m.ev === "saida") {
        for (const p of m.partes) {
          const t = p.t === "err" ? "err" : "out";
          const s = dec[t].decode(p.b, { stream: true });
          r.saida += s; if (t === "err") r.err += s;
          const u = r.eventos[r.eventos.length - 1];
          if (u && u.t === t) u.s += s; else r.eventos.push({ t, s });
        }
      } else if (m.ev === "eco") {
        r.eventos.push({ t: "eco", s: m.texto });
      } else if (m.ev === "limite") {
        r.estourou = true;
      } else if (m.ev === "fim") {
        r.exit = m.exit; r.sinal = m.sinal || null; r.detalhe = m.detalhe; r.leuSemEntrada = !!m.leuSemEntrada;
        fim();
      } else if (m.ev === "morto") {
        fim();
      } else if (m.ev === "falha") {
        clearTimeout(relogio); ouvintes.delete(id); falha(new Error(m.msg));
      }
    });
    worker.postMessage({ op: "executar", id, nome, arquivos, flags: opts.flags || null, args: opts.args || [], stdin: opts.stdin === undefined ? null : opts.stdin, interativo: false, semPch: !!opts.semPch });
  });
}

function versao() {
  try { return JSON.parse(fs.readFileSync(path.join(ASSETS, "manifesto.json"), "utf8")); } catch (e) { return null; }
}

module.exports = { executar, encerrar, iniciar, versao, TEMPO_MAX };
