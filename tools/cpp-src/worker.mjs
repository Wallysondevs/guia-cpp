/* =====================================================================
   Web Worker do "Experimente" do Guia C++ (fonte).
   tools/construir-cpp.mjs junta este arquivo + o núcleo do @yowasp/clang
   (remendado) + motor.mjs em assets/cpp/cpp-worker.js.
   O compilador e o programa rodam aqui, fora da página: um laço infinito
   não trava a aba e o botão "Parar" simplesmente encerra o worker.
   O mesmo arquivo roda no Node (tools/cpp-node.js), num worker_thread.

   Mensagens  página → worker: {op: "carregar"|"executar"|"entrada"|"eof", ...}
              worker → página: {ev: "progresso"|"pronto"|"compilado"|"saida"|"eco"|"espera"|"fim"|"falha"|"limite", ...}
   ===================================================================== */
import * as Y from "yowasp-nucleo"; // = @yowasp/clang/gen/bundle.js remendado (construir-cpp.mjs)
import { criarCompilador, criarEntrada, criarDisco, rodarPrograma, PrecisaEntrada, LimiteSaida, AMBIENTE, LIMITE_SAIDA, lerTar } from "./motor.mjs";

/* global __MANIFESTO__, __CORES_PEQUENOS__ */
const MANIFESTO = __MANIFESTO__;          // { versao, wasm: {arquivo, bytes, bytesGz}, sysroot: {…}, pchs: [{nome, arquivo, bytes, bytesGz, cabecalhos, assinatura, ansioso}] }
const CORES_PEQUENOS = __CORES_PEQUENOS__; // { "llvm.core2.wasm": base64, … }
const BASE = new URL(".", self.location.href).href;
const CACHE = "guia-cpp-" + MANIFESTO.versao;

let compilador = null;
let carregando = null;
let recursos = null; // { modulos, sysroot: ArrayBuffer, pchs: {nome: ArrayBuffer} } — devolvido à página para reiniciar rápido

function b64(s) {
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

/* ---------- download (com cache do navegador e barra de progresso) ---------- */
const progresso = { lidos: 0, total: 0, ultimo: 0 };
function avisarProgresso(forcar) {
  const agora = Date.now();
  if (!forcar && agora - progresso.ultimo < 120) return;
  progresso.ultimo = agora;
  postMessage({ ev: "progresso", lidos: progresso.lidos, total: progresso.total });
}
async function abrirCache() {
  try { if (typeof caches !== "undefined") return await caches.open(CACHE); } catch (e) { /* sem Cache API (Node, modo privado…) */ }
  return null;
}
// Baixa ARQUIVO.gz, descomprime e devolve um Response (do cache, quando já existe).
async function baixar(info, cache) {
  const url = new URL(info.arquivo, BASE).href;
  if (cache) {
    try {
      const r = await cache.match(url);
      if (r) { progresso.lidos += info.bytesGz; avisarProgresso(); return r; }
    } catch (e) { /* ignora */ }
  }
  const resp = await fetch(url + ".gz");
  if (!resp.ok) throw new Error("Não consegui baixar " + info.arquivo + ".gz (" + resp.status + ")");
  if (typeof DecompressionStream === "undefined") throw new Error("Este navegador é antigo demais (falta DecompressionStream). Atualize-o para rodar C++.");
  const contador = new TransformStream({
    transform(chunk, ctl) { progresso.lidos += chunk.byteLength; avisarProgresso(); ctl.enqueue(chunk); },
  });
  const tipo = /\.wasm$/.test(info.arquivo) ? "application/wasm" : "application/octet-stream";
  const descomp = new Response(resp.body.pipeThrough(contador).pipeThrough(new DecompressionStream("gzip")), { headers: { "content-type": tipo } });
  if (!cache) return descomp;
  const buf = await descomp.arrayBuffer();
  const pronto = new Response(buf, { headers: { "content-type": tipo, "content-length": String(buf.byteLength) } });
  try { await cache.put(url, pronto.clone()); } catch (e) { /* cota cheia: segue sem cache */ }
  return pronto;
}
async function compilarWasm(resp) {
  if (WebAssembly.compileStreaming && resp.headers.get("content-type") === "application/wasm") {
    try { return await WebAssembly.compileStreaming(resp.clone ? resp.clone() : resp); } catch (e) { /* cai para o modo comum */ }
  }
  return WebAssembly.compile(await resp.arrayBuffer());
}
async function limparCachesVelhos() {
  try {
    if (typeof caches === "undefined") return;
    for (const k of await caches.keys()) if (k.startsWith("guia-cpp-") && k !== CACHE) await caches.delete(k);
  } catch (e) { /* ok */ }
}

function montar(rec) {
  const pchs = MANIFESTO.pchs.map((p) => ({
    nome: p.nome, cabecalhos: p.cabecalhos, assinatura: p.assinatura, caminho: "pch/" + p.nome + ".pch",
    obter: async () => {
      if (!rec.pchs[p.nome]) rec.pchs[p.nome] = baixar(p, await abrirCache()).then((r) => r.arrayBuffer());
      return new Uint8Array(await rec.pchs[p.nome]);
    },
  }));
  compilador = criarCompilador({ Y, modulos: rec.modulos, sysroot: lerTar(rec.sysroot), pchs });
}

function garantir(dados) {
  if (!carregando) {
    carregando = (async () => {
      if (dados && dados.modulos) {
        recursos = { modulos: dados.modulos, sysroot: dados.sysroot, pchs: {} };
        for (const k of Object.keys(dados.pchs || {})) recursos.pchs[k] = Promise.resolve(dados.pchs[k]);
        montar(recursos);
        postMessage({ ev: "pronto" });
        return;
      }
      const cache = await abrirCache();
      limparCachesVelhos();
      const ansiosos = MANIFESTO.pchs.filter((p) => p.ansioso);
      progresso.total = MANIFESTO.wasm.bytesGz + MANIFESTO.sysroot.bytesGz + ansiosos.reduce((s, p) => s + p.bytesGz, 0);
      avisarProgresso(true);
      const modulos = {};
      for (const [k, v] of Object.entries(CORES_PEQUENOS)) modulos[k] = new WebAssembly.Module(b64(v));
      const pchs = {};
      for (const p of ansiosos) pchs[p.nome] = baixar(p, cache).then((r) => r.arrayBuffer());
      const [core, sysroot] = await Promise.all([
        baixar(MANIFESTO.wasm, cache).then(compilarWasm),
        baixar(MANIFESTO.sysroot, cache).then((r) => r.arrayBuffer()),
      ]);
      modulos["llvm.core.wasm"] = core;
      for (const p of ansiosos) await pchs[p.nome];
      recursos = { modulos, sysroot, pchs };
      montar(recursos);
      progresso.lidos = progresso.total; avisarProgresso(true);
      const pchProntos = {};
      for (const p of ansiosos) pchProntos[p.nome] = await pchs[p.nome];
      postMessage({ ev: "pronto", recursos: { modulos, sysroot, pchs: pchProntos } });
    })();
    carregando.catch((e) => { carregando = null; postMessage({ ev: "falha", msg: String((e && e.message) || e) }); });
  }
  return carregando;
}

/* ---------- saída em lotes (na ordem em que o programa escreveu) ---------- */
// O programa roda de forma síncrona (o laço de eventos do worker fica parado),
// então o setTimeout só dispara no fim: por isso a saída também é enviada
// direto quando passa um tempinho desde o último envio.
let pendente = [], pendenteBytes = 0, idAtual = null, agendado = false, ultimoEnvio = 0;
function despejar() {
  agendado = false;
  ultimoEnvio = Date.now();
  if (!pendente.length) return;
  const partes = [];
  for (const p of pendente) {
    const u = partes[partes.length - 1];
    if (u && u.t === p.t) u.l.push(p.b); else partes.push({ t: p.t, l: [p.b] });
  }
  const msg = partes.map((p) => {
    let n = 0; for (const b of p.l) n += b.length;
    const b = new Uint8Array(n); let o = 0; for (const x of p.l) { b.set(x, o); o += x.length; }
    return { t: p.t, b };
  });
  pendente = []; pendenteBytes = 0;
  postMessage({ ev: "saida", id: idAtual, partes: msg }, msg.map((p) => p.b.buffer));
}
function aoSaida(t, b) {
  pendente.push({ t, b }); pendenteBytes += b.length;
  if (pendenteBytes > 32768 || Date.now() - ultimoEnvio > 40) despejar();
  else if (!agendado) { agendado = true; setTimeout(despejar, 0); }
}

let entradaViva = null;     // modo JSPI: a entrada do programa que está rodando
let esperaLinha = null;     // modo repetição: quem espera a próxima linha digitada

function temJspi() { return typeof WebAssembly.Suspending === "function" && typeof WebAssembly.promising === "function"; }

async function executar(m) {
  idAtual = m.id;
  const nome = m.nome || "programa";
  const r = await compilador.compilar({ arquivos: m.arquivos, flags: m.flags, saida: nome, semPch: !!m.semPch });
  postMessage({ ev: "compilado", id: m.id, ok: r.ok, exit: r.exit, diag: r.diag, ms: r.ms, pch: r.pch || [] });
  if (!r.ok) { postMessage({ ev: "fim", id: m.id, exit: null, compilou: false }); return; }
  const modulo = await WebAssembly.compile(r.wasm);
  const base = { args: m.args || [], env: AMBIENTE, nome, limiteSaida: LIMITE_SAIDA };
  const eco = (linha) => { despejar(); postMessage({ ev: "eco", id: m.id, texto: linha }); };
  const espera = () => { despejar(); postMessage({ ev: "espera", id: m.id }); };
  let res;
  try {
    if (m.stdin !== null && m.stdin !== undefined || !m.interativo) {
      const entrada = criarEntrada({ texto: m.stdin !== null && m.stdin !== undefined ? m.stdin : "", aoEco: eco });
      res = await rodarPrograma(modulo, { ...base, disco: criarDisco(m.arquivos), entrada, aoSaida, jspi: false });
      res.leuSemEntrada = (m.stdin === null || m.stdin === undefined) && res.leuNoFim;
    } else if (temJspi() && !m.semJspi) {
      entradaViva = criarEntrada({ texto: null, aoEspera: espera });
      res = await rodarPrograma(modulo, { ...base, disco: criarDisco(m.arquivos), entrada: entradaViva, aoSaida, jspi: true });
    } else {
      // Sem JSPI: quando o programa pede uma linha que ainda não existe, ele
      // para; o leitor digita; o programa roda de novo desde o começo com
      // todas as linhas, e a saída que já apareceu não se repete.
      const linhas = [];
      let mostrados = 0, eof = false;
      for (;;) {
        let vistos = 0;
        const filtro = (t, b) => {
          const ini = vistos; vistos += b.length;
          if (vistos <= mostrados) return;
          const pula = Math.max(0, mostrados - ini);
          mostrados = vistos;
          aoSaida(t, pula ? b.subarray(pula) : b);
        };
        const entrada = criarEntrada({ linhas, texto: eof ? "" : null, aoEspera: () => {} });
        try {
          res = await rodarPrograma(modulo, { ...base, disco: criarDisco(m.arquivos), entrada, aoSaida: filtro, jspi: false });
          break;
        } catch (e) {
          if (!(e instanceof PrecisaEntrada)) throw e;
          espera();
          const v = await new Promise((ok) => { esperaLinha = ok; });
          esperaLinha = null;
          if (v === null) eof = true; else linhas.push(v);
        }
      }
    }
  } catch (e) {
    entradaViva = null;
    despejar();
    if (e instanceof LimiteSaida) { postMessage({ ev: "limite", id: m.id }); postMessage({ ev: "fim", id: m.id, exit: null, compilou: true, limite: true }); return; }
    throw e;
  }
  entradaViva = null;
  despejar();
  postMessage({ ev: "fim", id: m.id, compilou: true, exit: res.exit, sinal: res.sinal, detalhe: res.detalhe, leuSemEntrada: !!res.leuSemEntrada });
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.op === "carregar") { await garantir(m.recursos); return; }
    if (m.op === "entrada") {
      if (entradaViva) entradaViva.adicionar(m.texto);
      else if (esperaLinha) esperaLinha(m.texto);
      return;
    }
    if (m.op === "eof") {
      if (entradaViva) entradaViva.fim();
      else if (esperaLinha) esperaLinha(null);
      return;
    }
    await garantir();
    if (m.op === "executar") await executar(m);
  } catch (err) {
    despejar();
    postMessage({ ev: "falha", id: m.id, msg: String((err && err.stack) || (err && err.message) || err) });
  }
};
