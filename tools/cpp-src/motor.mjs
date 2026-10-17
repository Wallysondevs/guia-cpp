/* =====================================================================
   Motor do "Experimente" do Guia C++ — o MESMO código roda:
   - no navegador, dentro do Web Worker assets/cpp/cpp-worker.js
     (gerado por tools/construir-cpp.mjs a partir de tools/cpp-src/worker.mjs);
   - no Node (tools/testar-missoes.js e tools/sim.js carregam esse mesmo
     cpp-worker.js num worker_thread).

   Duas partes:
   1. criarCompilador(): o Clang/LLD 22 em WebAssembly (@yowasp/clang, ISC;
      LLVM: Apache-2.0 WITH LLVM-exception) com o sysroot do guia em memória
      (wasi-libc + libc++ 22 com exceções). Faz o que o `clang++` faria:
      pergunta ao driver (-###) quais comandos rodar, roda o cc1 de cada .cpp
      e o wasm-ld.
   2. rodarPrograma(): roda o programa gerado (WebAssembly WASI preview1) com
      um sistema de arquivos em memória (/home/ana), argumentos, variáveis de
      ambiente da Ana, entrada (STDIN) linha por linha e sinais do "Linux".
   ===================================================================== */

export const HOME = "/home/ana";
export const AMBIENTE = {
  SHELL: "/bin/bash",
  LANGUAGE: "pt_BR:pt:en",
  EDITOR: "nano",
  PWD: HOME,
  LOGNAME: "ana",
  TZ: "America/Sao_Paulo",
  HOME: HOME,
  LANG: "pt_BR.UTF-8",
  TERM: "xterm-256color",
  USER: "ana",
  SHLVL: "1",
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  _: "./programa",
};

// Opções que o editor sempre acrescenta (o leitor vê só as dele).
// -fwasm-exceptions: try/catch/throw de verdade (exceções do WebAssembly).
export const FLAGS_PADRAO = ["-std=c++23", "-Wall", "-Wextra"];
// -fsanitize=null (modo trap): no WebAssembly o endereço 0 é memória válida, então
// *ptr com ptr nulo não daria erro nenhum; com a checagem, o programa para como
// no Linux ("Falha de segmentação").
// -D_WASI_EMULATED_*: <csignal> (signal/raise), clock() e getpid() existem como no Linux.
const FLAGS_DRIVER = ["-fwasm-exceptions", "-fsanitize=null", "-fsanitize-trap=null",
  "-D_WASI_EMULATED_SIGNAL", "-D_WASI_EMULATED_PROCESS_CLOCKS", "-D_WASI_EMULATED_GETPID",
  "-fcolor-diagnostics", "-fansi-escape-codes"];
export { FLAGS_DRIVER };
const LIB = "/usr/lib/wasm32-wasip1";
const FLAGS_LINK = [
  LIB + "/guia-rt.o", "-lguia", "-lunwind",
  "-lwasi-emulated-signal", "-lwasi-emulated-process-clocks", "-lwasi-emulated-getpid",
  "--wrap=__main_void", "--wrap=abort",
  "--stack-first", "-z", "stack-size=8388608",      // pilha de 8 MB, como no Linux; estouro = falha de segmentação
  "--max-memory=268435456",                          // 256 MB: depois disso, new lança std::bad_alloc
];
export const LIMITE_SAIDA = 2 * 1024 * 1024;

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ---------------------------------------------------------------------
   tar (ustar) → árvore { nome: Uint8Array | {…} }
   --------------------------------------------------------------------- */
export function lerTar(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const raiz = {};
  const str = (o, n) => { let e = o; while (e < o + n && u8[e]) e++; return dec.decode(u8.subarray(o, e)); };
  let o = 0;
  while (o + 512 <= u8.length) {
    const nome0 = str(o, 100);
    if (!nome0) break;
    const prefixo = str(o + 345, 155);
    const nome = (prefixo ? prefixo + "/" : "") + nome0;
    const tam = parseInt(str(o + 124, 12).trim() || "0", 8);
    const tipo = String.fromCharCode(u8[o + 156] || 48);
    const partes = nome.replace(/^\.\//, "").split("/").filter(Boolean);
    let d = raiz;
    for (let i = 0; i < partes.length - 1; i++) d = d[partes[i]] || (d[partes[i]] = {});
    const ult = partes[partes.length - 1];
    if (tipo === "5") { if (ult && !d[ult]) d[ult] = {}; }
    else if (tipo === "0" || tipo === "\0") d[ult] = u8.subarray(o + 512, o + 512 + tam);
    o += 512 + Math.ceil(tam / 512) * 512;
  }
  return raiz;
}

/* ---------------------------------------------------------------------
   Diagnósticos do Clang (com cores ANSI)
   --------------------------------------------------------------------- */
export function semAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, ""); }

// Separa "programa.cpp:3:5: warning: unused variable 'x' [-Wunused-variable]" etc.
export function resumoDiagnosticos(txt) {
  const r = { erros: [], avisos: [], notas: [] };
  semAnsi(txt).split("\n").forEach((l) => {
    const m = /^(?:[^\s:][^:]*:(?:\d+:){0,2} )?(fatal error|error|warning|note): (.*)$/.exec(l);
    if (!m) return;
    if (m[1] === "warning") r.avisos.push(l);
    else if (m[1] === "note") r.notas.push(l);
    else r.erros.push(l);
  });
  return r;
}

// Cabeçalhos <…> incluídos no começo do arquivo, antes de qualquer outro código.
export function includesIniciais(src) {
  const s = String(src).replace(/\/\*[\s\S]*?\*\//g, (t) => t.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
  const r = [];
  for (const l of s.split("\n")) {
    if (/^\s*$/.test(l)) continue;
    const m = /^\s*#\s*include\s*<([^>]+)>\s*$/.exec(l);
    if (m) { r.push(m[1].trim()); continue; }
    if (/^\s*#\s*pragma\s+once\s*$/.test(l)) continue;
    break;
  }
  return r;
}

// Argumentos de um "cc1" sem o que muda de arquivo para arquivo ou não afeta um PCH.
export function assinaturaCc1(args) {
  const r = [];
  const pulaValor = new Set(["-main-file-name", "-o", "-dumpdir", "-x", "-include-pch", "-ferror-limit"]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (pulaValor.has(a)) { i++; continue; }
    if (/^-W|^-w$|^-pedantic|^-fcolor-diagnostics$|^-fansi-escape-codes$|^-emit-(obj|pch)$|^-fno-pch-timestamp$|^-fsyntax-only$/.test(a)) continue;
    if (i === args.length - 1 && !a.startsWith("-")) continue; // o arquivo de entrada
    r.push(a);
  }
  return r.join("\u0001");
}

// "  \"clang++\" \"-cc1\" …" (saída de -###) → lista de argumentos (copiado do runClang do @yowasp/clang)
function argsDaLinha(line) {
  return Array.from(line.matchAll(/ (?:([^ "]+)|"((?:[^"\\$]|\\["\\$])+)")/g), (m) => m[1] !== undefined ? m[1] : m[2].replaceAll(/\\["$\\]/g, (x) => x[1]));
}
function comandosDoDriver(saida) {
  let estado = 0;
  const cmds = [];
  for (const line of saida.split("\n")) {
    if (estado === 0 && !(line.startsWith("clang") || line.startsWith("Target:") || line.startsWith("Thread model:") || line.startsWith("InstalledDir:") || line.startsWith("Build config:"))) estado = 1;
    if (estado === 1) {
      if (line === " (in-process)") { /* nada */ }
      else if (line.startsWith(' "')) { const c = argsDaLinha(line); if (c[0] === "") c.shift(); cmds.push(c); }
      else if (line === "") { estado = 2; break; }
      else { estado = 3; break; }
    }
  }
  return estado === 2 || (estado === 1 && cmds.length) ? cmds : null;
}

/* ---------------------------------------------------------------------
   1. O compilador
   deps: { Y: núcleo do YoWASP (Environment, Exit, Directory, File, directoryFromTree, instantiate),
           modulos: { "llvm.core.wasm": WebAssembly.Module, … },
           sysroot: árvore { include, lib, share, pch… },
           pchs: [{ nome, cabecalhos: [...], caminho: "pch/iostream.pch", assinatura, obter: async () => Uint8Array }] }
   --------------------------------------------------------------------- */
export function criarCompilador(deps) {
  const { Y, modulos } = deps;
  const usr = Y.directoryFromTree(deps.sysroot);
  const pchs = deps.pchs || [];
  const cacheDriver = new Map();
  const instanciar = (m, imp) => new WebAssembly.Instance(m, imp);

  /** Roda uma ferramenta do LLVM ("clang++", "wasm-ld", "ar", …) na pasta raiz (Directory). */
  function rodarLLVM(argv, raiz, saida) {
    const env = new Y.Environment();
    env.args = ["yowasp-llvm"].concat(argv);
    env.root = raiz;
    env.vars = [["LANG", "C"]];
    env.stdin = null;
    env.stdout = (b) => { if (b && saida) saida(b.slice()); };
    env.stderr = (b) => { if (b && saida) saida(b.slice()); };
    const cmd = Y.instantiate((f) => modulos[f], { runtime: env.exports }, instanciar);
    try { cmd.run.run(); return 0; }
    catch (e) { if (e instanceof Y.Exit) return e.code; throw e; }
  }

  function novaRaiz(arquivos) {
    const files = { usr, tmp: new Y.Directory({}) };
    for (const a of arquivos) {
      const partes = a.nome.split("/").filter(Boolean);
      let d = files;
      for (let i = 0; i < partes.length - 1; i++) {
        if (!d[partes[i]]) d[partes[i]] = new Y.Directory({});
        d = d[partes[i]].files;
      }
      d[partes[partes.length - 1]] = new Y.File(typeof a.codigo === "string" ? enc.encode(a.codigo) : a.codigo);
    }
    return new Y.Directory(files);
  }
  function lerArquivo(raiz, caminho) {
    try { const e = raiz.traverse(caminho.replace(/^\//, "")); return e instanceof Y.File ? e.data : null; } catch (e) { return null; }
  }

  async function garantirPch(p) {
    if (p.pronto) return;
    const dados = await p.obter();
    const partes = p.caminho.split("/");
    let d = usr;
    for (let i = 0; i < partes.length - 1; i++) {
      if (!d.files[partes[i]]) d.files[partes[i]] = new Y.Directory({});
      d = d.files[partes[i]];
    }
    d.files[partes[partes.length - 1]] = new Y.File(dados);
    p.pronto = true;
  }

  function escolherPch(cc1, fonte) {
    if (!pchs.length || fonte === undefined) return null;
    const ass = assinaturaCc1(cc1);
    const inc = new Set(includesIniciais(fonte));
    let melhor = null;
    for (const p of pchs) {
      if (p.assinatura !== ass) continue;
      if (!p.cabecalhos.every((h) => inc.has(h))) continue;
      if (!melhor || p.cabecalhos.length > melhor.cabecalhos.length) melhor = p;
    }
    return melhor;
  }

  /**
   * opts: { arquivos: [{nome, codigo}], flags: [...] (padrão FLAGS_PADRAO), saida: "programa",
   *         semPch: bool, aoDiag(bytes) }
   * → { ok, exit, diag (texto com ANSI), wasm (Uint8Array|null), fontes: [...], comando, ms, pch }
   */
  async function compilar(opts) {
    const t0 = Date.now();
    const flags = opts.flags || FLAGS_PADRAO;
    const fontes = opts.arquivos.filter((a) => /\.(cpp|cc|cxx|c\+\+)$/i.test(a.nome)).map((a) => a.nome);
    const saidaNome = opts.saida || "programa";
    const comando = ["clang++"].concat(flags, fontes, ["-o", saidaNome]);
    let diag = "";
    const juntar = (b) => { const s = dec.decode(b, { stream: false }); diag += s; if (opts.aoDiag) opts.aoDiag(s); };
    const raiz = novaRaiz(opts.arquivos);
    if (!fontes.length) {
      juntar(enc.encode("clang++: \x1b[0;1;31merror: \x1b[0m\x1b[1mno input files\x1b[0m\n"));
      return { ok: false, exit: 1, diag, wasm: null, fontes, comando, ms: Date.now() - t0 };
    }
    const argsDriver = ["clang++"].concat(flags, FLAGS_DRIVER, fontes, ["-o", saidaNome]);
    const chave = JSON.stringify(argsDriver);
    let cmds = cacheDriver.get(chave);
    if (!cmds) {
      let txt = "";
      const ex = rodarLLVM(argsDriver.slice(0, 1).concat(["-###"], argsDriver.slice(1)), raiz, (b) => { txt += dec.decode(b); });
      cmds = ex === 0 ? comandosDoDriver(txt) : null;
      if (!cmds) {
        // o driver recusou as opções (ex.: -std=c++99): mostra o que ele disse
        juntar(enc.encode(txt.split("\n").filter((l) => !/^(clang version|Target:|Thread model:|InstalledDir:|Build config:| ")/.test(l)).join("\n")));
        return { ok: false, exit: ex || 1, diag, wasm: null, fontes, comando, ms: Date.now() - t0 };
      }
      cacheDriver.set(chave, cmds);
    }
    let falhou = 0, usouPch = [];
    const link = [];
    for (const c of cmds) {
      if (c[1] === "-cc1") {
        let args = c.slice();
        const entrada = args[args.length - 1];
        const fonte = opts.arquivos.find((a) => a.nome === entrada);
        const p = opts.semPch ? null : escolherPch(args, fonte && fonte.codigo);
        if (p) {
          await garantirPch(p);
          const i = args.lastIndexOf("-x");
          args.splice(i, 0, "-include-pch", "/usr/" + p.caminho);
          usouPch.push(p.nome);
        }
        const ex = rodarLLVM(args, raiz, juntar);
        if (ex !== 0) falhou = ex;
      } else if (/wasm-ld$/.test(c[0])) {
        link.push(c);
      } else {
        const ex = rodarLLVM(c, raiz, juntar);
        if (ex !== 0) falhou = ex;
      }
    }
    if (falhou) return { ok: false, exit: 1, diag, wasm: null, fontes, comando, ms: Date.now() - t0, pch: usouPch };
    for (const c of link) {
      const ex = rodarLLVM(c.concat(FLAGS_LINK), raiz, juntar);
      if (ex !== 0) {
        // o que o driver do clang escreve quando o linker falha
        juntar(enc.encode("clang++: \x1b[0;1;31merror: \x1b[0m\x1b[1mlinker command failed with exit code " + ex + " (use -v to see invocation)\x1b[0m\n"));
        return { ok: false, exit: 1, diag, wasm: null, fontes, comando, ms: Date.now() - t0, pch: usouPch };
      }
    }
    const wasm = lerArquivo(raiz, saidaNome);
    return { ok: !!wasm, exit: wasm ? 0 : 1, diag, wasm: wasm ? wasm.slice() : null, fontes, comando, ms: Date.now() - t0, pch: usouPch };
  }

  /** Ferramenta genérica (usada no build: gerar PCH, ar…). arquivos: [{nome, codigo}] → {exit, saida, ler(caminho)} */
  function ferramenta(argv, arquivos) {
    const raiz = novaRaiz(arquivos || []);
    let txt = "";
    const exit = rodarLLVM(argv, raiz, (b) => { txt += dec.decode(b); });
    return { exit, saida: txt, ler: (c) => lerArquivo(raiz, c) };
  }

  /** Como o `clang++ …` de verdade (sem os acréscimos do editor), para o build. */
  function executarDriver(argv, arquivos) {
    const raiz = novaRaiz(arquivos || []);
    let txt = "";
    const junta = (b) => { txt += dec.decode(b); };
    let ex = rodarLLVM([argv[0], "-###"].concat(argv.slice(1)), raiz, junta);
    const cmds = ex === 0 ? comandosDoDriver(txt) : null;
    if (!cmds) return { exit: ex || 1, saida: txt, ler: () => null, cmds: null };
    txt = "";
    for (const c of cmds) { ex = rodarLLVM(c, raiz, junta); if (ex) break; }
    return { exit: ex, saida: txt, ler: (c) => lerArquivo(raiz, c), cmds };
  }
  /** Só os comandos que o driver rodaria (-###). */
  function comandos(argv, arquivos) {
    let txt = "";
    const ex = rodarLLVM([argv[0], "-###"].concat(argv.slice(1)), novaRaiz(arquivos || []), (b) => { txt += dec.decode(b); });
    return ex === 0 ? comandosDoDriver(txt) : null;
  }

  return { compilar, ferramenta, executarDriver, comandos, rodarLLVM, usr, cacheDriver };
}

/* ---------------------------------------------------------------------
   Entrada (STDIN) do programa, entregue LINHA POR LINHA (como um terminal):
   cada leitura recebe no máximo uma linha. Sem linha disponível:
     - se a entrada acabou (texto fixo, ou Ctrl+D) → fim de arquivo (null);
     - senão → "ainda não" (undefined): o programa espera o leitor digitar.
   opts: { texto: string|null, linhas: [string] (já digitadas, sem eco),
           aoEco(linha), aoEspera() }
   --------------------------------------------------------------------- */
export function criarEntrada(opts) {
  const fila = [];
  let eof = false, esperando = false, quemEspera = null, leuNoFim = false;
  function adicionar(texto, digitada) {
    for (const p of String(texto).split(/(?<=\n)/)) if (p !== "") fila.push({ linha: p, digitada: !!digitada });
  }
  if (opts.linhas) for (const l of opts.linhas) adicionar(l, true);
  if (opts.texto !== null && opts.texto !== undefined) { adicionar(opts.texto, false); eof = true; }
  let atual = null, k = 0;
  return {
    /** até max bytes de UMA linha; null = fim de arquivo; undefined = esperar */
    ler(max) {
      if (!atual || k >= atual.length) {
        if (!fila.length) {
          if (eof) { leuNoFim = true; return null; }
          if (!esperando) { esperando = true; if (opts.aoEspera) opts.aoEspera(); }
          return undefined;
        }
        const it = fila.shift();
        atual = enc.encode(it.linha); k = 0; esperando = false;
        if (!it.digitada && opts.aoEco) opts.aoEco(it.linha);
      }
      const n = Math.min(max, atual.length - k);
      const r = atual.subarray(k, k + n); k += n;
      return r;
    },
    adicionar(texto) { adicionar(texto, true); const f = quemEspera; quemEspera = null; if (f) f(); },
    fim() { eof = true; const f = quemEspera; quemEspera = null; if (f) f(); },
    esperar() { return new Promise((ok) => { quemEspera = ok; }); },
    get leuNoFim() { return leuNoFim; },
    get acabou() { return eof && !fila.length && (!atual || k >= atual.length); },
  };
}

/* ---------------------------------------------------------------------
   2. Rodar o programa (WASI preview1)
   --------------------------------------------------------------------- */
export class SaidaPrograma { constructor(code) { this.code = code; } }
export class PrecisaEntrada { }
export class LimiteSaida { }

const E = { SUCCESS: 0, ACCES: 2, AGAIN: 6, BADF: 8, EXIST: 20, INVAL: 28, IO: 29, ISDIR: 31, NAMETOOLONG: 37, NOENT: 44, NOSYS: 52, NOTDIR: 54, NOTEMPTY: 55, NOTSUP: 58, PERM: 63, SPIPE: 70, NOTCAPABLE: 76 };
const FT = { UNKNOWN: 0, CHAR: 2, DIR: 3, FILE: 4 };
const TODOS_DIREITOS = 0x1fffffffn;
const DIREITOS_TTY = (1n << 1n) | (1n << 3n) | (1n << 6n) | (1n << 21n) | (1n << 27n); // read, fdstat_set_flags, write, filestat_get, poll
export const SINAIS = {
  4: { nome: "SIGILL", msg: "Instrução ilegal" },
  6: { nome: "SIGABRT", msg: "Abortado" },
  8: { nome: "SIGFPE", msg: "Exceção de ponto flutuante" },
  11: { nome: "SIGSEGV", msg: "Falha de segmentação" },
};

let inodeSeq = 100;
function novoArq(dados) { return { tipo: "arq", dados: dados || new Uint8Array(0), ino: ++inodeSeq, mtime: BigInt(Date.now()) * 1000000n }; }
function novaPasta() { return { tipo: "dir", filhos: new Map(), ino: ++inodeSeq, mtime: BigInt(Date.now()) * 1000000n }; }

/** Sistema de arquivos da "máquina da Ana": /home/ana com os arquivos da caixa, /tmp. */
export function criarDisco(arquivos) {
  const raiz = novaPasta();
  const mk = (caminho) => {
    let d = raiz;
    for (const p of caminho.split("/").filter(Boolean)) {
      if (!d.filhos.has(p)) d.filhos.set(p, novaPasta());
      d = d.filhos.get(p);
    }
    return d;
  };
  mk("/tmp"); mk("/usr/bin"); mk("/etc");
  raiz.filhos.get("etc").filhos.set("hostname", novoArq(enc.encode("notebook\n")));
  const casa = mk(HOME);
  for (const a of arquivos || []) {
    const partes = a.nome.replace(/^\/+/, "").split("/").filter(Boolean);
    const base = a.nome.startsWith("/") ? raiz : casa;
    let d = base;
    for (let i = 0; i < partes.length - 1; i++) { if (!d.filhos.has(partes[i])) d.filhos.set(partes[i], novaPasta()); d = d.filhos.get(partes[i]); }
    d.filhos.set(partes[partes.length - 1], novoArq(typeof a.codigo === "string" ? enc.encode(a.codigo) : a.codigo));
  }
  return raiz;
}

/**
 * modulo: WebAssembly.Module do programa.
 * opts: { args: [], env: {}, disco (criarDisco), entrada (criarEntrada),
 *         aoSaida(tipo "out"|"err", Uint8Array), jspi: bool (entrada interativa e sleep sem travar),
 *         limiteSaida }
 * → { exit, sinal (número|null), motivo }   (lança PrecisaEntrada no modo "repetição", sem JSPI)
 */
export async function rodarPrograma(modulo, opts) {
  const args = ["./programa"].concat(opts.args || []);
  if (opts.nome) args[0] = "./" + opts.nome;
  const env = Object.entries(opts.env || AMBIENTE).map(([k, v]) => k + "=" + v);
  const disco = opts.disco || criarDisco([]);
  const entrada = opts.entrada || criarEntrada({ texto: "" });
  const jspi = !!opts.jspi && typeof WebAssembly.Suspending === "function";
  const limite = opts.limiteSaida || LIMITE_SAIDA;
  let memoria = null, sinalPedido = null, totalSaida = 0;
  const mem = () => new DataView(memoria.buffer);
  const bytes = () => new Uint8Array(memoria.buffer);
  const lerStr = (p, n) => dec.decode(bytes().slice(p, p + n));

  // descritores: 0,1,2 terminal; 3 = "/" (preaberto)
  const fds = new Map();
  fds.set(0, { tipo: "tty", fd: 0 });
  fds.set(1, { tipo: "tty", fd: 1 });
  fds.set(2, { tipo: "tty", fd: 2 });
  fds.set(3, { tipo: "dir", no: disco, caminho: "/", preaberto: true });
  let proxFd = 4;

  function resolver(dirFd, caminho, criarPai) {
    const base = fds.get(dirFd);
    if (!base || base.tipo !== "dir") return { erro: E.BADF };
    const partes = caminho.split("/").filter((p) => p !== "" && p !== ".");
    const pilha = [base.no];
    if (caminho.startsWith("/")) pilha.length = 1, pilha[0] = disco;
    for (let i = 0; i < partes.length - 1; i++) {
      const p = partes[i];
      if (p === "..") { if (pilha.length > 1) pilha.pop(); continue; }
      const atual = pilha[pilha.length - 1];
      if (atual.tipo !== "dir") return { erro: E.NOTDIR };
      let prox = atual.filhos.get(p);
      if (!prox) { if (criarPai) { prox = novaPasta(); atual.filhos.set(p, prox); } else return { erro: E.NOENT }; }
      pilha.push(prox);
    }
    let nome = partes.length ? partes[partes.length - 1] : ".";
    let pai = pilha[pilha.length - 1];
    if (nome === "..") { if (pilha.length > 1) pilha.pop(); pai = pilha.length > 1 ? pilha[pilha.length - 2] : pilha[0]; nome = "."; return { pai, nome, no: pilha[pilha.length - 1] }; }
    if (pai.tipo !== "dir") return { erro: E.NOTDIR };
    const no = nome === "." ? pai : pai.filhos.get(nome);
    return { pai, nome, no };
  }

  function escreverFilestat(p, no) {
    const v = mem();
    v.setBigUint64(p, 1n, true);
    v.setBigUint64(p + 8, BigInt(no.ino || 1), true);
    v.setUint8(p + 16, no.tipo === "dir" ? FT.DIR : no.tipo === "arq" ? FT.FILE : FT.CHAR);
    v.setBigUint64(p + 24, 1n, true);
    v.setBigUint64(p + 32, BigInt(no.tipo === "arq" ? no.dados.length : 0), true);
    const t = no.mtime || 0n;
    v.setBigUint64(p + 40, t, true); v.setBigUint64(p + 48, t, true); v.setBigUint64(p + 56, t, true);
  }

  function saida(fd, b) {
    if (totalSaida + b.length > limite) {
      const resto = Math.max(0, limite - totalSaida);
      if (resto) opts.aoSaida(fd === 2 ? "err" : "out", b.slice(0, resto));
      totalSaida = limite;
      throw new LimiteSaida();
    }
    totalSaida += b.length;
    opts.aoSaida(fd === 2 ? "err" : "out", b.slice());
  }

  function iovecs(iovs, n) {
    const v = mem(), r = [];
    for (let i = 0; i < n; i++) r.push([v.getUint32(iovs + i * 8, true), v.getUint32(iovs + i * 8 + 4, true)]);
    return r;
  }

  function dormirSincrono(ms) {
    if (ms <= 0) return;
    try {
      if (typeof SharedArrayBuffer === "function") { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); return; }
    } catch (e) { /* sem Atomics.wait aqui */ }
    const fim = Date.now() + ms;
    while (Date.now() < fim) { /* espera ativa (sem JSPI nem SharedArrayBuffer) */ }
  }

  // leitura do STDIN: síncrona (com texto) ou suspensa (JSPI) até o leitor digitar
  function lerStdinSinc(iovs, n, pLidos) {
    const lista = iovecs(iovs, n);
    let total = 0;
    for (const [p, len] of lista) {
      if (!len) continue;
      const r = entrada.ler(len);
      if (r === undefined) { if (total) break; return undefined; }
      if (r === null) break;
      bytes().set(r, p); total += r.length;
      break; // no máximo uma linha por leitura, como o terminal
    }
    mem().setUint32(pLidos, total, true);
    return E.SUCCESS;
  }

  const wasi = {
    args_sizes_get(pc, pt) { mem().setUint32(pc, args.length, true); mem().setUint32(pt, args.reduce((s, a) => s + enc.encode(a).length + 1, 0), true); return 0; },
    args_get(pv, pb) { let o = pb; args.forEach((a, i) => { mem().setUint32(pv + i * 4, o, true); const b = enc.encode(a + "\0"); bytes().set(b, o); o += b.length; }); return 0; },
    environ_sizes_get(pc, pt) { mem().setUint32(pc, env.length, true); mem().setUint32(pt, env.reduce((s, a) => s + enc.encode(a).length + 1, 0), true); return 0; },
    environ_get(pv, pb) { let o = pb; env.forEach((a, i) => { mem().setUint32(pv + i * 4, o, true); const b = enc.encode(a + "\0"); bytes().set(b, o); o += b.length; }); return 0; },
    clock_res_get(id, p) { mem().setBigUint64(p, 1000n, true); return 0; },
    clock_time_get(id, prec, p) {
      let t;
      if (id === 0) t = BigInt(Date.now()) * 1000000n + BigInt(Math.floor((performance.now() % 1) * 1e6));
      else t = BigInt(Math.floor(performance.now() * 1e6));
      mem().setBigUint64(p, t, true); return 0;
    },
    fd_write(fd, iovs, n, pEscritos) {
      const f = fds.get(fd);
      if (!f) return E.BADF;
      let total = 0;
      if (f.tipo === "tty") {
        if (fd === 0) return E.BADF;
        const partes = iovecs(iovs, n).filter(([, l]) => l);
        let tam = 0; partes.forEach(([, l]) => { tam += l; });
        const b = new Uint8Array(tam); let o = 0;
        for (const [p, l] of partes) { b.set(bytes().subarray(p, p + l), o); o += l; }
        if (tam) saida(fd, b);
        total = tam;
      } else if (f.tipo === "arq") {
        if (!f.escrita) return E.BADF;
        for (const [p, l] of iovecs(iovs, n)) {
          if (!l) continue;
          if (f.append) f.pos = f.no.dados.length;
          gravar(f.no, f.pos, bytes().subarray(p, p + l)); f.pos += l; total += l;
        }
      } else return E.ISDIR;
      mem().setUint32(pEscritos, total, true);
      return 0;
    },
    fd_pwrite(fd, iovs, n, off, pEscritos) {
      const f = fds.get(fd);
      if (!f || f.tipo !== "arq" || !f.escrita) return E.BADF;
      let pos = Number(off), total = 0;
      for (const [p, l] of iovecs(iovs, n)) { gravar(f.no, pos, bytes().subarray(p, p + l)); pos += l; total += l; }
      mem().setUint32(pEscritos, total, true); return 0;
    },
    fd_read(fd, iovs, n, pLidos) {
      const f = fds.get(fd);
      if (!f) return E.BADF;
      if (f.tipo === "tty") {
        if (fd !== 0) return E.BADF;
        const r = lerStdinSinc(iovs, n, pLidos);
        if (r !== undefined) return r;
        if (!jspi) throw new PrecisaEntrada();
        return entrada.esperar().then(() => wasi.fd_read(fd, iovs, n, pLidos));
      }
      if (f.tipo !== "arq") return E.ISDIR;
      if (!f.leitura) return E.BADF;
      let total = 0;
      for (const [p, l] of iovecs(iovs, n)) {
        const d = f.no.dados, k = Math.min(l, Math.max(0, d.length - f.pos));
        if (k > 0) { bytes().set(d.subarray(f.pos, f.pos + k), p); f.pos += k; total += k; }
        if (k < l) break;
      }
      mem().setUint32(pLidos, total, true); return 0;
    },
    fd_pread(fd, iovs, n, off, pLidos) {
      const f = fds.get(fd);
      if (!f || f.tipo !== "arq") return E.BADF;
      let pos = Number(off), total = 0;
      for (const [p, l] of iovecs(iovs, n)) {
        const d = f.no.dados, k = Math.min(l, Math.max(0, d.length - pos));
        if (k > 0) { bytes().set(d.subarray(pos, pos + k), p); pos += k; total += k; }
        if (k < l) break;
      }
      mem().setUint32(pLidos, total, true); return 0;
    },
    fd_seek(fd, off, whence, pNovo) {
      const f = fds.get(fd);
      if (!f) return E.BADF;
      if (f.tipo !== "arq") return f.tipo === "tty" ? E.SPIPE : E.ISDIR;
      let base = whence === 0 ? 0 : whence === 1 ? f.pos : f.no.dados.length;
      const novo = base + Number(off);
      if (novo < 0) return E.INVAL;
      f.pos = novo;
      mem().setBigUint64(pNovo, BigInt(novo), true); return 0;
    },
    fd_tell(fd, p) { const f = fds.get(fd); if (!f) return E.BADF; if (f.tipo !== "arq") return E.SPIPE; mem().setBigUint64(p, BigInt(f.pos), true); return 0; },
    fd_close(fd) { if (!fds.has(fd)) return E.BADF; if (fd > 3) fds.delete(fd); return 0; },
    fd_sync() { return 0; }, fd_datasync() { return 0; }, fd_advise() { return 0; },
    fd_allocate(fd, off, len) { const f = fds.get(fd); if (!f || f.tipo !== "arq") return E.BADF; const fim = Number(off) + Number(len); if (fim > f.no.dados.length) gravar(f.no, fim, new Uint8Array(0)); return 0; },
    fd_fdstat_get(fd, p) {
      const f = fds.get(fd);
      if (!f) return E.BADF;
      const v = mem();
      v.setUint8(p, f.tipo === "tty" ? FT.CHAR : f.tipo === "dir" ? FT.DIR : FT.FILE);
      v.setUint16(p + 2, f.append ? 1 : 0, true);
      v.setBigUint64(p + 8, f.tipo === "tty" ? DIREITOS_TTY : TODOS_DIREITOS, true);
      v.setBigUint64(p + 16, f.tipo === "tty" ? 0n : TODOS_DIREITOS, true);
      return 0;
    },
    fd_fdstat_set_flags(fd, flags) { const f = fds.get(fd); if (!f) return E.BADF; f.append = !!(flags & 1); return 0; },
    fd_fdstat_set_rights() { return 0; },
    fd_filestat_get(fd, p) {
      const f = fds.get(fd);
      if (!f) return E.BADF;
      escreverFilestat(p, f.tipo === "tty" ? { tipo: "tty", ino: 1 + fd } : f.no);
      return 0;
    },
    fd_filestat_set_size(fd, tam) {
      const f = fds.get(fd);
      if (!f || f.tipo !== "arq") return E.BADF;
      const n = Number(tam), d = new Uint8Array(n); d.set(f.no.dados.subarray(0, n)); f.no.dados = d; tocar(f.no); return 0;
    },
    fd_filestat_set_times() { return 0; },
    fd_prestat_get(fd, p) {
      const f = fds.get(fd);
      if (!f || !f.preaberto) return E.BADF;
      mem().setUint8(p, 0); mem().setUint32(p + 4, enc.encode(f.caminho).length, true); return 0;
    },
    fd_prestat_dir_name(fd, p, n) {
      const f = fds.get(fd);
      if (!f || !f.preaberto) return E.BADF;
      bytes().set(enc.encode(f.caminho).subarray(0, n), p); return 0;
    },
    fd_readdir(fd, buf, len, cookie, pUsado) {
      const f = fds.get(fd);
      if (!f || f.tipo !== "dir") return E.BADF;
      const nomes = [[".", f.no], ["..", f.no]].concat(Array.from(f.no.filhos.entries()));
      let o = 0;
      for (let i = Number(cookie); i < nomes.length && o < len; i++) {
        const [nome, no] = nomes[i];
        const nb = enc.encode(nome);
        const ent = new Uint8Array(24 + nb.length);
        const v = new DataView(ent.buffer);
        v.setBigUint64(0, BigInt(i + 1), true);
        v.setBigUint64(8, BigInt(no.ino || 1), true);
        v.setUint32(16, nb.length, true);
        v.setUint8(20, no.tipo === "dir" ? FT.DIR : FT.FILE);
        ent.set(nb, 24);
        const k = Math.min(ent.length, len - o);
        bytes().set(ent.subarray(0, k), buf + o); o += k;
      }
      mem().setUint32(pUsado, o, true); return 0;
    },
    fd_renumber(de, para) { const f = fds.get(de); if (!f) return E.BADF; fds.set(para, f); fds.delete(de); return 0; },
    path_open(dirFd, dirflags, p, n, oflags, rBase, rInh, fdflags, pFd) {
      const caminho = lerStr(p, n);
      const r = resolver(dirFd, caminho, false);
      if (r.erro) return r.erro;
      let no = r.no;
      const criar = oflags & 1, soDir = oflags & 2, excl = oflags & 4, trunc = oflags & 8;
      if (no && criar && excl) return E.EXIST;
      if (!no) {
        if (!criar) return E.NOENT;
        if (r.pai.tipo !== "dir") return E.NOTDIR;
        no = novoArq(); r.pai.filhos.set(r.nome, no);
      }
      if (soDir && no.tipo !== "dir") return E.NOTDIR;
      const direitos = BigInt(rBase);
      const escrita = (direitos & ((1n << 6n) | (1n << 4n))) !== 0n; // fd_write ou fd_pwrite
      if (no.tipo === "dir") {
        if (escrita && !soDir && (oflags & 9)) return E.ISDIR;
        const fd = proxFd++; fds.set(fd, { tipo: "dir", no, caminho });
        mem().setUint32(pFd, fd, true); return 0;
      }
      if (trunc) { no.dados = new Uint8Array(0); tocar(no); }
      const fd = proxFd++;
      fds.set(fd, { tipo: "arq", no, pos: 0, leitura: (direitos & 2n) !== 0n || (direitos & (1n << 1n)) !== 0n, escrita, append: !!(fdflags & 1) });
      mem().setUint32(pFd, fd, true); return 0;
    },
    path_create_directory(dirFd, p, n) {
      const r = resolver(dirFd, lerStr(p, n), false);
      if (r.erro) return r.erro;
      if (r.no) return E.EXIST;
      r.pai.filhos.set(r.nome, novaPasta()); return 0;
    },
    path_filestat_get(dirFd, flags, p, n, pSt) {
      const r = resolver(dirFd, lerStr(p, n), false);
      if (r.erro) return r.erro;
      if (!r.no) return E.NOENT;
      escreverFilestat(pSt, r.no); return 0;
    },
    path_filestat_set_times() { return 0; },
    path_remove_directory(dirFd, p, n) {
      const r = resolver(dirFd, lerStr(p, n), false);
      if (r.erro) return r.erro;
      if (!r.no) return E.NOENT;
      if (r.no.tipo !== "dir") return E.NOTDIR;
      if (r.no.filhos.size) return E.NOTEMPTY;
      r.pai.filhos.delete(r.nome); return 0;
    },
    path_unlink_file(dirFd, p, n) {
      const r = resolver(dirFd, lerStr(p, n), false);
      if (r.erro) return r.erro;
      if (!r.no) return E.NOENT;
      if (r.no.tipo === "dir") return E.ISDIR;
      r.pai.filhos.delete(r.nome); return 0;
    },
    path_rename(fd1, p1, n1, fd2, p2, n2) {
      const a = resolver(fd1, lerStr(p1, n1), false), b = resolver(fd2, lerStr(p2, n2), false);
      if (a.erro) return a.erro; if (b.erro) return b.erro;
      if (!a.no) return E.NOENT;
      if (b.no && b.no.tipo === "dir" && b.no.filhos.size) return E.NOTEMPTY;
      a.pai.filhos.delete(a.nome); b.pai.filhos.set(b.nome, a.no); return 0;
    },
    path_link() { return E.NOTSUP; },
    path_symlink() { return E.NOTSUP; },
    path_readlink() { return E.INVAL; },
    poll_oneoff(pIn, pOut, n, pN) {
      const v = mem();
      let espera = 0, eventos = 0, querStdin = false;
      for (let i = 0; i < n; i++) {
        const s = pIn + i * 48;
        const tag = v.getUint8(s + 8);
        if (tag === 0) {
          const id = v.getUint32(s + 16, true), t = v.getBigUint64(s + 24, true), absoluto = v.getUint16(s + 40, true) & 1;
          let ns = Number(t);
          if (absoluto) ns -= id === 0 ? Date.now() * 1e6 : performance.now() * 1e6;
          espera = Math.max(espera, ns / 1e6);
        } else if (tag === 1) querStdin = true;
        const o = pOut + eventos * 32;
        new Uint8Array(memoria.buffer, o, 32).fill(0);
        v.setBigUint64(o, v.getBigUint64(s, true), true);
        v.setUint8(o + 10, tag);
        eventos++;
      }
      v.setUint32(pN, eventos, true);
      if (querStdin) return 0;
      if (espera > 0) {
        if (jspi) return new Promise((ok) => setTimeout(() => ok(0), espera));
        dormirSincrono(espera);
      }
      return 0;
    },
    proc_exit(code) { throw new SaidaPrograma(code); },
    proc_raise(sig) { sinalPedido = sig; throw new SaidaPrograma(128 + sig); },
    random_get(p, n) {
      const b = new Uint8Array(n);
      for (let o = 0; o < n; o += 65536) crypto.getRandomValues(b.subarray(o, Math.min(n, o + 65536)));
      bytes().set(b, p); return 0;
    },
    sched_yield() { return 0; },
    sock_accept() { return E.NOTSUP; }, sock_recv() { return E.NOTSUP; }, sock_send() { return E.NOTSUP; }, sock_shutdown() { return E.NOTSUP; },
  };
  function tocar(no) { no.mtime = BigInt(Date.now()) * 1000000n; }
  function gravar(no, pos, b) {
    const fim = pos + b.length;
    if (fim > no.dados.length) { const d = new Uint8Array(fim); d.set(no.dados); no.dados = d; }
    no.dados.set(b, pos); tocar(no);
  }

  // imports pedidos pelo módulo (o que faltar vira ENOSYS)
  const imports = { wasi_snapshot_preview1: {}, guia: { sinal(s) { sinalPedido = s; } } };
  for (const imp of WebAssembly.Module.imports(modulo)) {
    if (imp.kind !== "function") continue;
    if (imp.module === "wasi_snapshot_preview1") {
      let f = wasi[imp.name] || (() => E.NOSYS);
      if (jspi && (imp.name === "fd_read" || imp.name === "poll_oneoff")) f = new WebAssembly.Suspending(f);
      imports.wasi_snapshot_preview1[imp.name] = f;
    } else if (imp.module !== "guia") {
      imports[imp.module] = imports[imp.module] || {};
      imports[imp.module][imp.name] = () => { throw new WebAssembly.RuntimeError("import ausente: " + imp.module + "." + imp.name); };
    }
  }
  const inst = await WebAssembly.instantiate(modulo, imports);
  memoria = inst.exports.memory;
  const iniciar = jspi ? WebAssembly.promising(inst.exports._start) : inst.exports._start;
  try {
    await iniciar();
    return { exit: 0, sinal: null, leuNoFim: entrada.leuNoFim };
  } catch (e) {
    if (e instanceof SaidaPrograma) {
      if (sinalPedido) return { exit: 128 + sinalPedido, sinal: sinalPedido, leuNoFim: entrada.leuNoFim };
      return { exit: e.code & 255, sinal: null, leuNoFim: entrada.leuNoFim }; // como no Linux: só 8 bits
    }
    if (e instanceof PrecisaEntrada || e instanceof LimiteSaida) throw e;
    const msg = String((e && e.message) || e);
    let sinal = 11;
    if (sinalPedido === 6) sinal = 6;
    else if (e instanceof WebAssembly.RuntimeError || e instanceof RangeError) {
      if (/unreachable/i.test(msg)) sinal = 11; // checagem de ponteiro nulo (ou __builtin_trap)
      else if (/divi(de|sion) by zero|remainder by zero|integer overflow|divide result unrepresentable/i.test(msg)) sinal = 8;
      else sinal = 11; // memória fora dos limites, pilha estourada, ponteiro de função inválido…
    } else if (typeof WebAssembly.Exception === "function" && e instanceof WebAssembly.Exception) sinal = 6;
    else throw e;
    return { exit: 128 + sinal, sinal, detalhe: msg, leuNoFim: entrada.leuNoFim };
  }
}
