/* =====================================================================
   cppsim.js — o "Experimente" do Guia C++, com um compilador C++ DE VERDADE.
   O Clang/LLD 22 compilado para WebAssembly (@yowasp/clang, ISC; LLVM:
   Apache-2.0 WITH LLVM-exception) fica em assets/cpp/ e só é baixado no
   primeiro clique em "Rodar". Ele roda num Web Worker (assets/cpp/cpp-worker.js):
   compila o código com `clang++ -std=c++23 -Wall -Wextra` e roda o programa
   gerado (WebAssembly). Um laço infinito não trava a página: "Parar" encerra o worker.

   Monta as caixas  <div class="trycpp" data-goal="…" data-stdin="…" data-args="…" data-flags="…">
   (contrato: CONTRIBUINDO.md, seções 3 e 4).
   Também roda no Node (tools/testar-missoes.js usa as funções puras daqui).
   ===================================================================== */
(function () {
  "use strict";
  var CPP_BYTES = 32544469;  // download na 1ª vez (atualizado por tools/construir-cpp.mjs)
  var TEMPO_MAX = 15000;     // ms rodando sem parar (sem contar a espera por entrada)
  var MAX_LINHAS = 3000;     // linhas mostradas no terminal (o resto é resumido)
  var FLAGS_PADRAO = "-std=c++23 -Wall -Wextra";
  var CppSim = { FLAGS_PADRAO: FLAGS_PADRAO };

  /* =====================================================================
     1. Funções puras (navegador e Node)
     ===================================================================== */
  function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  CppSim.escHtml = escHtml;

  var ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", bull: "•", middot: "·", deg: "°", times: "×", divide: "÷", euro: "€", pound: "£", cent: "¢", sect: "§", para: "¶", ordf: "ª", ordm: "º", larr: "←", rarr: "→", uarr: "↑", darr: "↓", harr: "↔", rArr: "⇒", check: "✓", aacute: "á", Aacute: "Á", eacute: "é", Eacute: "É", iacute: "í", Iacute: "Í", oacute: "ó", Oacute: "Ó", uacute: "ú", Uacute: "Ú", atilde: "ã", Atilde: "Ã", otilde: "õ", Otilde: "Õ", ccedil: "ç", Ccedil: "Ç", acirc: "â", Acirc: "Â", ecirc: "ê", Ecirc: "Ê", ocirc: "ô", Ocirc: "Ô", agrave: "à", Agrave: "À", uuml: "ü", Uuml: "Ü", ntilde: "ñ", Ntilde: "Ñ", le: "≤", ge: "≥", ne: "≠", shy: "\u00ad", zwj: "\u200d", thinsp: "\u2009", ensp: "\u2002", emsp: "\u2003" };
  function decodificarEntidades(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, function (t, n) {
      if (n.charAt(0) === "#") {
        var c = n.charAt(1).toLowerCase() === "x" ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10);
        try { return String.fromCodePoint(c); } catch (e) { return t; }
      }
      return Object.prototype.hasOwnProperty.call(ENTIDADES, n) ? ENTIDADES[n] : t;
    });
  }
  CppSim.decodificarEntidades = decodificarEntidades;

  function semAnsi(s) { return String(s || "").replace(/\x1b\[[0-9;]*m/g, ""); }
  CppSim.semAnsi = semAnsi;

  // Linhas de diagnóstico do Clang: "arquivo:linha:coluna: error|warning|note: …"
  var RE_DIAG = /^(?:[^\s:][^:]*:(?:\d+:){0,2} )?(fatal error|error|warning|note): (.*)$/;
  function diagnosticos(diag) {
    var r = { erros: [], avisos: [], notas: [] };
    semAnsi(diag).split("\n").forEach(function (l) {
      var m = RE_DIAG.exec(l);
      if (!m) return;
      if (m[1] === "warning") r.avisos.push(l); else if (m[1] === "note") r.notas.push(l); else r.erros.push(l);
    });
    return r;
  }
  CppSim.diagnosticos = diagnosticos;

  /* Metas (data-goal), separadas por vírgula. Escapes: "\," = vírgula literal,
     "\\" = uma barra invertida literal (qualquer outro "\x" fica como está,
     então "\d", "\s" etc. das regex não mudam). Uma vírgula sem escape só
     separa metas se o que vem depois for o nome de uma meta. */
  var META_TIPOS = /^(out|outre|compila|erro|aviso|semaviso|exit|src)(:|\s*$|\s*,)/;
  CppSim.META_NOMES = ["out", "outre", "compila", "erro", "aviso", "semaviso", "exit", "src"];
  function dividirMetas(meta) {
    var r = [], cur = "";
    meta = String(meta || "");
    for (var i = 0; i < meta.length; i++) {
      var c = meta[i];
      if (c === "\\" && (meta[i + 1] === "," || meta[i + 1] === "\\")) { cur += meta[i + 1]; i++; continue; }
      if (c === "," && META_TIPOS.test(meta.slice(i + 1).replace(/^\s+/, ""))) { r.push(cur); cur = ""; continue; }
      cur += c;
    }
    r.push(cur);
    return r.map(function (x) { return x.replace(/^\s+/, ""); }).filter(Boolean);
  }
  CppSim.dividirMetas = dividirMetas;

  // "/regex/flags" → RegExp; senão null (é texto)
  function regexDe(v) {
    var m = /^\/([\s\S]*)\/([gimsuy]*)$/.exec(v);
    if (!m) return null;
    return new RegExp(m[1], m[2].replace("g", ""));
  }
  CppSim.regexDe = regexDe;
  function confere(v, txt) {
    var re = regexDe(v);
    return re ? re.test(txt) : txt.indexOf(v) >= 0;
  }

  /* ctx: { compilou: bool, diag: texto do compilador (com ou sem ANSI),
            out: saída do PROGRAMA (stdout+stderr, na ordem; nunca o compilador),
            exit: código de saída do programa (null se não rodou), src: código do leitor (todas as abas) } */
  function checarMeta(meta, ctx) {
    var falhas = [];
    var d = null;
    function diags() { if (!d) d = diagnosticos(ctx.diag); return d; }
    var diagTxt = semAnsi(ctx.diag);
    dividirMetas(meta).forEach(function (g) {
      var i = g.indexOf(":"), tipo = (i < 0 ? g : g.slice(0, i)).trim(), val = i < 0 ? "" : g.slice(i + 1), ok = false;
      try {
        switch (tipo) {
          case "out": ok = ctx.out !== null && ctx.out !== undefined && String(ctx.out).indexOf(val) >= 0; break;
          case "outre": ok = ctx.out !== null && ctx.out !== undefined && new RegExp(val).test(ctx.out); break;
          case "compila": ok = !!ctx.compilou; break;
          case "erro": ok = !ctx.compilou && confere(val, diagTxt); break;
          case "aviso": ok = diags().avisos.some(function (l) { return confere(val, l); }); break;
          case "semaviso": ok = !!ctx.compilou && diags().avisos.length === 0; break;
          case "exit": ok = ctx.exit !== null && ctx.exit !== undefined && String(ctx.exit) === val.trim(); break;
          case "src": ok = new RegExp(val, "m").test(ctx.src || ""); break;
          default: ok = false;
        }
      } catch (e) { ok = false; }
      if (!ok) falhas.push(g);
    });
    return falhas;
  }
  CppSim.checarMeta = checarMeta;

  function decodificarAttr(s) { return String(s).replace(/\\n/g, "\n").replace(/\\t/g, "\t"); }
  CppSim.decodificarAttr = decodificarAttr;
  // data-stdin → texto entregue ao programa (termina com Enter, como quem digita)
  function textoEntrada(s) { s = decodificarAttr(s); return s === "" || /\n$/.test(s) ? s : s + "\n"; }
  CppSim.textoEntrada = textoEntrada;
  // "a 'b c' \"d\"" → ["a", "b c", "d"] (como o bash separa os argumentos)
  function dividirArgs(s) {
    var r = [], cur = null, i = 0;
    s = String(s || "");
    while (i < s.length) {
      var c = s[i];
      if (/\s/.test(c)) { if (cur !== null) { r.push(cur); cur = null; } i++; continue; }
      if (cur === null) cur = "";
      if (c === "'") { var f = s.indexOf("'", i + 1); if (f < 0) f = s.length; cur += s.slice(i + 1, f); i = f + 1; continue; }
      if (c === '"') { i++; while (i < s.length && s[i] !== '"') { if (s[i] === "\\" && /["\\$`]/.test(s[i + 1] || "")) i++; cur += s[i]; i++; } i++; continue; }
      if (c === "\\" && i + 1 < s.length) { cur += s[i + 1]; i += 2; continue; }
      cur += c; i++;
    }
    if (cur !== null) r.push(cur);
    return r;
  }
  CppSim.dividirArgs = dividirArgs;
  function citarArg(x) { return /^[\w@%+=:,.\/-]+$/.test(x) ? x : "'" + String(x).replace(/'/g, "'\\''") + "'"; }
  CppSim.citarArg = citarArg;
  // nome do executável: o do 1º arquivo sem a extensão (ola.cpp → ola)
  function nomePrograma(arquivo) { return (String(arquivo || "programa.cpp").replace(/^.*\//, "").replace(/\.[^.]*$/, "") || "programa").replace(/[^\w.-]/g, "_"); }
  CppSim.nomePrograma = nomePrograma;
  function ehFonte(nome) { return /\.(cpp|cc|cxx|c\+\+)$/i.test(nome); }
  CppSim.ehFonte = ehFonte;
  // o comando mostrado no terminal
  function linhaCompilar(flags, arquivos) {
    var fontes = arquivos.filter(function (a) { return ehFonte(a.nome); }).map(function (a) { return a.nome; });
    var principal = fontes[0] || (arquivos[0] && arquivos[0].nome);
    return "clang++ " + (flags ? flags + " " : "") + fontes.join(" ") + " -o " + nomePrograma(principal);
  }
  CppSim.linhaCompilar = linhaCompilar;

  // Sinais (como o bash mostra no Ubuntu em português)
  var SINAIS = { 4: "Instrução ilegal", 6: "Abortado", 8: "Exceção de ponto flutuante", 11: "Falha de segmentação", 9: "Morto", 15: "Terminado" };
  CppSim.SINAIS = SINAIS;
  function mensagemSinal(sinal) { return SINAIS[sinal] ? SINAIS[sinal] + " (imagem do núcleo gravada)" : ""; }
  CppSim.mensagemSinal = mensagemSinal;


  // Texto com cores ANSI (diagnósticos do Clang, programas que usam "\033[31m") → HTML
  var CORES_ANSI = { 30: "c-k", 31: "c-r", 32: "c-g", 33: "c-y", 34: "c-b", 35: "c-m", 36: "c-c", 37: "c-w", 90: "c-k", 91: "c-r", 92: "c-g", 93: "c-y", 94: "c-b", 95: "c-m", 96: "c-c", 97: "c-w" };
  function ansiParaHtml(s, estado) {
    estado = estado || { negrito: false, cor: null };
    var r = "", re = /\x1b\[([0-9;]*)m/g, ult = 0, m;
    function trecho(t) {
      if (!t) return;
      var cls = (estado.negrito ? "c-n " : "") + (estado.cor || "");
      r += cls.trim() ? '<span class="' + cls.trim() + '">' + escHtml(t) + "</span>" : escHtml(t);
    }
    while ((m = re.exec(s))) {
      trecho(s.slice(ult, m.index));
      ult = re.lastIndex;
      (m[1] === "" ? ["0"] : m[1].split(";")).forEach(function (p) {
        var n = +p;
        if (n === 0) { estado.negrito = false; estado.cor = null; }
        else if (n === 1) estado.negrito = true;
        else if (n === 22) estado.negrito = false;
        else if (n === 39) estado.cor = null;
        else if (CORES_ANSI[n]) estado.cor = CORES_ANSI[n];
      });
    }
    trecho(s.slice(ult).replace(/\x1b\[[0-9;]*$/, ""));
    return r;
  }
  CppSim.ansiParaHtml = ansiParaHtml;

  if (typeof module === "object" && module.exports) { module.exports = CppSim; }
  if (typeof document === "undefined") return;
  window.CppSim = CppSim;

  /* =====================================================================
     2. O compilador no Web Worker (um por página, compartilhado pelas caixas)
     ===================================================================== */
  var base = (function () {
    var s = document.querySelectorAll("script[src]");
    for (var i = 0; i < s.length; i++) { var src = s[i].getAttribute("src"); if (/cppsim\.js(\?|$)/.test(src)) return src.replace(/cppsim\.js.*$/, ""); }
    return "assets/";
  })();
  var worker = null, recursos = null, carregado = false, pronto = null, ouvintes = {}, seq = 0, aoProgresso = [];
  var dono = null; // caixa que está rodando um programa

  function mb(bytes) { return (bytes / 1e6).toFixed(0).replace(".", ","); }
  CppSim.tamanhoDownload = function () { return mb(CPP_BYTES) + " MB"; };

  function carregarCompilador(progresso) {
    if (progresso) aoProgresso.push(progresso);
    if (pronto) return pronto;
    pronto = new Promise(function (ok, falha) {
      try { worker = new Worker(base + "cpp/cpp-worker.js"); }
      catch (e) { falha(e); return; }
      worker.onmessage = function (e) {
        var m = e.data;
        if (m.ev === "progresso") { aoProgresso.forEach(function (f) { try { f(m.lidos, m.total); } catch (x) {} }); return; }
        if (m.ev === "pronto") { if (m.recursos) recursos = m.recursos; carregado = true; aoProgresso = []; ok(); return; }
        if (m.ev === "falha" && !m.id) { aoProgresso = []; pronto = null; falha(new Error(m.msg)); return; }
        var f = ouvintes[m.id];
        if (f) f(m);
        else if (m.ev === "falha") console.error("cppsim:", m.msg);
      };
      worker.onerror = function (e) {
        var msg = (e && e.message) || "o worker do compilador falhou";
        if (pronto && !carregado) { pronto = null; falha(new Error(msg)); }
        console.error("cppsim:", msg);
      };
      worker.postMessage({ op: "carregar", recursos: recursos });
    });
    pronto.catch(function () { pronto = null; if (worker) { worker.terminate(); worker = null; } });
    return pronto;
  }
  function encerrarWorker() {
    if (worker) worker.terminate();
    worker = null; pronto = null; carregado = false;
    var os = ouvintes; ouvintes = {};
    Object.keys(os).forEach(function (k) { try { os[k]({ ev: "morto", id: +k }); } catch (e) {} });
  }
  function enviar(msg, ouvinte) {
    var id = ++seq; msg.id = id;
    if (ouvinte) ouvintes[id] = ouvinte;
    worker.postMessage(msg);
    return id;
  }
  function esquecer(id) { delete ouvintes[id]; }

  /* =====================================================================
     3. Interface
     ===================================================================== */
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (html !== undefined && html !== null) e.innerHTML = html;
    return e;
  }
  function lerPre(pre) { return pre.textContent.replace(/^\n/, "").replace(/\n$/, ""); }

  function montar(box) {
    if (box.getAttribute("data-montado")) return;
    box.setAttribute("data-montado", "1");
    var meta = box.getAttribute("data-goal") || "";
    var stdinAttr = box.getAttribute("data-stdin");
    var argsIni = box.getAttribute("data-args") || "";
    var flagsAttr = box.getAttribute("data-flags");
    var flags = flagsAttr !== null ? flagsAttr.trim() : FLAGS_PADRAO;
    var padrao = box.getAttribute("data-file") || "programa.cpp";
    var scripts = Array.prototype.slice.call(box.querySelectorAll("pre.script"));
    var sols = Array.prototype.slice.call(box.querySelectorAll("pre.solucao"));
    var abas = scripts.map(function (p, i) { return { nome: p.getAttribute("data-file") || (i === 0 ? padrao : "arquivo" + i + ".cpp"), original: lerPre(p), atual: lerPre(p) }; });
    if (!abas.length) abas.push({ nome: padrao, original: "", atual: "" });
    var solucao = sols.length ? sols.map(function (p, i) { return { nome: p.getAttribute("data-file") || (abas[i] ? abas[i].nome : padrao), codigo: lerPre(p) }; }) : null;
    scripts.concat(sols).forEach(function (p) { p.style.display = "none"; });
    var ativa = 0;

    var w = el("div", { "class": "ts tc" });
    var entradaHtml = stdinAttr !== null
      ? '<label class="tc-entrada-l">Entrada: <textarea class="tc-entrada" rows="' + Math.min(4, Math.max(1, textoEntrada(stdinAttr).replace(/\n$/, "").split("\n").length)) + '" spellcheck="false" autocomplete="off" autocapitalize="off" title="O que o programa vai ler do teclado (std::cin), uma linha por Enter"></textarea></label>' : "";
    w.innerHTML =
      '<div class="ts-bar"><span class="tc-tabs"></span><span class="ts-sp"></span>' +
      (solucao ? '<button type="button" class="sim-btn ts-sol">Ver solução</button>' : "") +
      '<button type="button" class="sim-btn ts-rest" title="Volta ao código original">Restaurar</button></div>' +
      '<div class="ts-confirma" hidden><span>Trocar o seu código pela solução?</span> <button type="button" class="sim-btn2 ts-sim">Sim, mostrar</button> <button type="button" class="sim-btn2 secundario ts-nao">Cancelar</button></div>' +
      '<div class="ts-editor"><pre class="ts-nums" aria-hidden="true"></pre><textarea class="ts-code" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="Código C++"></textarea></div>' +
      '<div class="ts-run">' +
      '<label class="ts-args-l">Argumentos: <input class="ts-args" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="(nenhum)"></label>' + entradaHtml +
      '<button type="button" class="ts-rodar">▶ Rodar</button></div>' +
      '<div class="tc-carga" hidden><span class="tc-carga-txt"></span><span class="tc-barra"><i></i></span></div>' +
      '<div class="sim ts-saida" hidden><div class="sim-bar"><span class="sim-dots"><i></i><i></i><i></i></span><span class="sim-title">Terminal — ana@notebook: ~</span></div><div class="sim-screen ts-tela"><div class="sim-out"></div></div></div>' +
      '<p class="tc-nota">O editor compila com o <strong>Clang</strong> (e a biblioteca libc++); os terminais das aulas mostram o <strong>g++</strong>. As mensagens dizem a mesma coisa com outras palavras. <a href="simulador.html">Saiba mais</a>.</p>';
    box.appendChild(w);
    var status = null;
    if (meta) { status = el("p", { "class": "sim-status", "aria-live": "polite" }, "Missão em andamento…"); box.appendChild(status); }

    var ta = w.querySelector(".ts-code"), nums = w.querySelector(".ts-nums"), btn = w.querySelector(".ts-rodar");
    var carga = w.querySelector(".tc-carga"), cargaTxt = w.querySelector(".tc-carga-txt"), barra = w.querySelector(".tc-barra i");
    var argsIn = w.querySelector(".ts-args"), entradaIn = w.querySelector(".tc-entrada");
    var saidaBox = w.querySelector(".ts-saida"), out = w.querySelector(".sim-out"), tela = w.querySelector(".ts-tela");
    argsIn.value = argsIni;
    if (entradaIn) entradaIn.value = textoEntrada(stdinAttr).replace(/\n$/, "");
    ta.value = abas[0].atual;
    var cumprida = false, sessao = null;

    /* ---------- editor ---------- */
    function ajustar() {
      var n = ta.value.split("\n").length, t = "";
      for (var i = 1; i <= n; i++) t += i + "\n";
      nums.textContent = t;
      ta.style.height = "auto";
      ta.style.height = Math.max(ta.scrollHeight, 60) + "px";
    }
    function salvarAba() { abas[ativa].atual = ta.value; }
    function desenharAbas() {
      var cont = w.querySelector(".tc-tabs");
      cont.innerHTML = abas.map(function (a, i) { return '<button type="button" class="tc-tab' + (i === ativa ? " on" : "") + '" data-i="' + i + '" aria-pressed="' + (i === ativa) + '">' + escHtml(a.nome) + "</button>"; }).join("");
      Array.prototype.forEach.call(cont.querySelectorAll(".tc-tab"), function (b) { b.addEventListener("click", function () { trocarAba(+b.getAttribute("data-i")); }); });
    }
    function trocarAba(i) { salvarAba(); ativa = i; ta.value = abas[i].atual; ajustar(); desenharAbas(); }
    desenharAbas();
    function inserir(txt, a, b) {
      if (ta.setRangeText) ta.setRangeText(txt, a, b, "end");
      else { ta.value = ta.value.slice(0, a) + txt + ta.value.slice(b); ta.selectionStart = ta.selectionEnd = a + txt.length; }
      salvarAba(); ajustar();
    }
    ta.addEventListener("input", function () { salvarAba(); ajustar(); });
    ta.addEventListener("keydown", function (e) {
      var a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
      if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        var ini = v.lastIndexOf("\n", a - 1) + 1;
        if (e.shiftKey) {
          var tira = /^ {1,4}|^\t/.exec(v.slice(ini));
          if (tira) { ta.value = v.slice(0, ini) + v.slice(ini + tira[0].length); ta.selectionStart = Math.max(ini, a - tira[0].length); ta.selectionEnd = Math.max(ini, b - tira[0].length); salvarAba(); ajustar(); }
        } else if (a !== b && v.slice(a, b).indexOf("\n") >= 0) {
          var bloco = v.slice(ini, b).replace(/^/gm, "    ");
          ta.value = v.slice(0, ini) + bloco + v.slice(b); ta.selectionStart = ini; ta.selectionEnd = ini + bloco.length; salvarAba(); ajustar();
        } else inserir("    ", a, b);
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); rodar(); }
      else if (e.key === "Enter" && !e.shiftKey) {
        var ini2 = v.lastIndexOf("\n", a - 1) + 1, antes = v.slice(ini2, a), ind = /^[ \t]*/.exec(antes)[0];
        if (/[{(\[]\s*$/.test(antes) && !/^\s*(\/\/|\*)/.test(antes)) ind += "    ";
        if (ind) { e.preventDefault(); inserir("\n" + ind, a, b); }
      } else if (e.key === "}" && a === b && /^[ \t]+$/.test(v.slice(v.lastIndexOf("\n", a - 1) + 1, a))) {
        // "}" sozinho na linha volta um nível
        var ini3 = v.lastIndexOf("\n", a - 1) + 1, esp = v.slice(ini3, a);
        if (esp.length >= 4) { e.preventDefault(); ta.value = v.slice(0, a - 4) + "}" + v.slice(b); ta.selectionStart = ta.selectionEnd = a - 3; salvarAba(); ajustar(); }
      } else if (e.key === "Escape") { ta.blur(); }
    });
    w.querySelector(".ts-rest").addEventListener("click", function () { abas.forEach(function (a) { a.atual = a.original; }); abas = abas.filter(function (a) { return !a.extra; }); ativa = Math.min(ativa, abas.length - 1); ta.value = abas[ativa].atual; ajustar(); desenharAbas(); });
    var conf = w.querySelector(".ts-confirma");
    if (solucao) {
      w.querySelector(".ts-sol").addEventListener("click", function () { conf.hidden = false; });
      w.querySelector(".ts-sim").addEventListener("click", function () {
        solucao.forEach(function (sl) {
          var a = abas.filter(function (x) { return x.nome === sl.nome; })[0];
          if (a) a.atual = sl.codigo; else abas.push({ nome: sl.nome, original: "", atual: sl.codigo, extra: true });
        });
        ta.value = abas[ativa].atual; ajustar(); desenharAbas(); conf.hidden = true;
      });
      w.querySelector(".ts-nao").addEventListener("click", function () { conf.hidden = true; });
    }
    ajustar();

    function arquivos() { salvarAba(); return abas.map(function (a) { return { nome: a.nome, codigo: a.atual }; }); }
    function fonte() { return abas.map(function (a) { return a.atual; }).join("\n"); }
    function verificar(ctx) {
      if (!status || cumprida) return;
      ctx.src = fonte();
      var f = checarMeta(meta, ctx);
      if (!f.length) { cumprida = true; status.textContent = "✔ Missão cumprida!"; status.className = "sim-status ok"; return; }
      var tipos = f.map(function (x) { return x.split(":")[0].trim(); });
      if (tipos.every(function (t) { return t === "src" || t === "exit"; })) status.textContent = "Missão em andamento… (ainda falta: " + f.join(", ") + ")";
      else if (tipos.indexOf("compila") >= 0 || (tipos.indexOf("semaviso") >= 0 && !ctx.compilou)) status.textContent = "Missão em andamento… (o código ainda não compila)";
      else if (tipos.indexOf("semaviso") >= 0) status.textContent = "Missão em andamento… (o compilador ainda dá avisos)";
      else if (tipos.indexOf("erro") >= 0) status.textContent = "Missão em andamento… (a missão pede um erro de compilação" + (ctx.compilou ? "; o código ainda compila)" : " diferente)");
      else if (tipos.indexOf("aviso") >= 0) status.textContent = "Missão em andamento… (a missão pede um aviso do compilador)";
      else status.textContent = "Missão em andamento… (a saída ainda não é a esperada)";
    }

    /* ---------- carregamento do compilador (só na primeira vez) ---------- */
    function garantirCompilador() {
      if (pronto && carregado) return pronto;
      carga.hidden = false;
      var txt0 = recursos ? "Reiniciando o compilador…" : "Baixando o compilador C++ (≈ " + mb(CPP_BYTES) + " MB, só na primeira vez)…";
      cargaTxt.textContent = txt0;
      barra.style.width = "0%";
      var p = carregarCompilador(function (lidos, total) {
        var pct = Math.min(100, Math.round(lidos * 100 / (total || CPP_BYTES)));
        barra.style.width = pct + "%";
        cargaTxt.textContent = pct >= 100 ? "Preparando o compilador…" : txt0 + " " + pct + "%";
      });
      return p.then(function () { carga.hidden = true; }, function (e) {
        carga.hidden = false; barra.style.width = "0%";
        cargaTxt.textContent = "Não consegui carregar o compilador: " + ((e && e.message) || e) + " Confira a internet e clique em Rodar de novo.";
        throw e;
      });
    }

    /* ---------- terminal ---------- */
    function linhaCmd(cmd) { out.appendChild(el("div", { "class": "sim-cmd" }, '<span class="c-u">ana@notebook</span>:<span class="c-d">~</span>$ ' + escHtml(cmd))); rolar(); }
    function info(txt, cls) { var d = el("div", { "class": cls || "sim-info" }); d.textContent = txt; out.appendChild(d); rolar(); return d; }
    function rolar() { tela.scrollTop = tela.scrollHeight; }

    // Texto chega em pedaços; segmentos {t: "out"|"err"|"eco", s}
    function Terminal() { this.linha = null; this.segs = []; this.n = 0; this.omitidas = 0; this.cauda = []; this.ansi = { negrito: false, cor: null }; }
    Terminal.prototype.escrever = function (t, s) {
      var partes = s.split("\n");
      for (var i = 0; i < partes.length; i++) {
        if (partes[i]) this.seg(t, partes[i]);
        if (i < partes.length - 1) this.fechar();
      }
    };
    Terminal.prototype.seg = function (t, s) {
      var u = this.segs[this.segs.length - 1];
      if (u && u.t === t) u.s += s; else this.segs.push({ t: t, s: s });
      this.desenhar();
    };
    Terminal.prototype.html = function (segs) {
      var est = { negrito: this.ansi.negrito, cor: this.ansi.cor };
      return segs.map(function (x) {
        if (x.t === "eco") return '<span class="sim-digitado">' + escHtml(x.s) + "</span>";
        var h = ansiParaHtml(x.s, est);
        return x.t === "err" ? '<span class="sim-err">' + h + "</span>" : h;
      }).join("");
    };
    Terminal.prototype.desenhar = function () {
      if (this.n >= MAX_LINHAS) return;
      if (!this.linha) { this.linha = el("div"); out.appendChild(this.linha); }
      var campo = this.linha.querySelector(".ts-campo");
      this.linha.innerHTML = this.html(this.segs);
      if (campo) this.linha.appendChild(campo);
    };
    Terminal.prototype.fechar = function () {
      if (this.n < MAX_LINHAS) { this.desenhar(); if (this.linha && !this.linha.innerHTML) this.linha.innerHTML = "<br>"; }
      else { this.omitidas++; this.cauda.push(this.segs); if (this.cauda.length > 40) this.cauda.shift(); }
      // as cores ANSI continuam na próxima linha
      var self = this; this.segs.forEach(function (x) { if (x.t !== "eco") ansiParaHtml(x.s, self.ansi); });
      this.n++; this.linha = null; this.segs = [];
    };
    Terminal.prototype.terminar = function () {
      if (this.segs.length) this.fechar();
      if (this.omitidas) {
        var pulo = this.omitidas - this.cauda.length, self = this;
        if (pulo > 0) info("(… mais " + pulo.toLocaleString("pt-BR") + " linhas — o editor mostra só o começo e o fim …)");
        this.cauda.forEach(function (c) { out.appendChild(el("div", null, self.html(c) || "<br>")); });
      }
    };
    Terminal.prototype.linhaAtual = function () {
      if (!this.linha) { this.linha = el("div"); out.appendChild(this.linha); this.desenhar(); }
      return this.linha;
    };

    function parar(motivo) {
      if (!sessao) return;
      var s = sessao;
      s.motivo = motivo || "^C";
      if (s.rodando) encerrarWorker(); // avisa s.ouvinte com {ev: "morto"}
      else finalizar(s, null, s.motivo);
    }

    function finalizar(s, m, motivo) {
      if (s.fim) return;
      s.fim = true;
      clearInterval(s.relogio);
      if (s.campo && s.campo.parentNode) s.campo.parentNode.removeChild(s.campo);
      if (s.id) esquecer(s.id);
      if (s.term) {
        if (motivo === "^C") s.term.escrever("eco", "^C");
        s.term.terminar();
      }
      var exit = m ? m.exit : null;
      if (m && m.sinal) info(mensagemSinal(m.sinal), "sim-err");
      if (motivo && motivo !== "^C") info(motivo, "sim-info");
      var codigo = exit === null || exit === undefined ? (motivo === "^C" ? 130 : null) : exit;
      if (s.compilou === false) codigo = s.exitCompilacao;
      out.appendChild(el("div", { "class": "ts-codigo" + (codigo ? " ts-erro" : "") }, codigo === null || codigo === undefined ? "[programa interrompido]" : "[código de saída: " + codigo + "]"));
      rolar();
      sessao = null; if (dono === parar) dono = null;
      btn.textContent = "▶ Rodar"; btn.disabled = false;
      if (s.compilou === false) verificar({ compilou: false, diag: s.diag, out: null, exit: null });
      else if (exit !== null && exit !== undefined) verificar({ compilou: true, diag: s.diag, out: s.texto, exit: exit });
    }

    function pedirEntrada(s) {
      if (s.campo || !worker) return;
      var campo = el("input", { "class": "ts-campo", type: "text", spellcheck: "false", autocomplete: "off", autocapitalize: "off", "aria-label": "Entrada do programa (Enter envia, Ctrl+D encerra a entrada)" });
      s.term.linhaAtual().appendChild(campo);
      s.campo = campo; s.esperando = true;
      campo.focus({ preventScroll: true });
      rolar();
      function sair() { if (campo.parentNode) campo.parentNode.removeChild(campo); s.campo = null; s.esperando = false; s.desde = Date.now(); }
      campo.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          var v = campo.value;
          sair();
          s.term.escrever("eco", v + "\n");
          if (worker) worker.postMessage({ op: "entrada", texto: v + "\n" });
          rolar();
        } else if (e.ctrlKey && (e.key === "d" || e.key === "D")) {
          e.preventDefault(); sair();
          if (worker) worker.postMessage({ op: "eof" });
        } else if (e.ctrlKey && (e.key === "c" || e.key === "C") && campo.selectionStart === campo.selectionEnd) {
          e.preventDefault(); parar();
        }
      });
    }

    function rodar() {
      if (sessao) { parar(); return; }
      var arqs = arquivos();
      var nome = nomePrograma((arqs.filter(function (a) { return ehFonte(a.nome); })[0] || arqs[0]).nome);
      saidaBox.hidden = false;
      out.innerHTML = "";
      var args = dividirArgs(argsIn.value);
      linhaCmd(linhaCompilar(flags, arqs));
      var s = sessao = { texto: "", diag: "", dec: { out: new TextDecoder(), err: new TextDecoder() }, gasto: 0, desde: 0, esperando: false, fim: false, rodando: false };
      btn.textContent = "■ Parar"; btn.disabled = false;
      var compilando = info("(compilando…)", "sim-info tc-compilando");
      garantirCompilador().then(function () {
        if (sessao !== s) return;
        if (dono && dono !== parar) dono("(outro programa foi iniciado nesta página)");
        s.rodando = true; dono = parar;
        var stdin = entradaIn ? textoEntrada(entradaIn.value) : null;
        s.ouvinte = function (m) {
          if (s.fim) return;
          if (m.ev === "compilado") {
            if (compilando.parentNode) compilando.parentNode.removeChild(compilando);
            s.diag = m.diag; s.compilou = m.ok; s.exitCompilacao = m.exit;
            if (m.diag) {
              var est = { negrito: false, cor: null };
              m.diag.replace(/\n$/, "").split("\n").forEach(function (l) { out.appendChild(el("div", { "class": "tc-diag" }, ansiParaHtml(l, est) || "<br>")); });
            }
            if (m.ok) {
              linhaCmd("./" + nome + (args.length ? " " + args.map(citarArg).join(" ") : ""));
              s.term = new Terminal();
              s.desde = Date.now();
              s.relogio = setInterval(function () {
                if (s.esperando || s.fim) return;
                var agora = Date.now(); s.gasto += agora - s.desde; s.desde = agora;
                if (s.gasto > TEMPO_MAX) parar("(o editor parou o programa: ele rodou mais de " + TEMPO_MAX / 1000 + " segundos sem terminar — laço infinito?)");
              }, 500);
            }
            rolar();
          } else if (m.ev === "saida") {
            m.partes.forEach(function (p) {
              var txt = s.dec[p.t === "err" ? "err" : "out"].decode(p.b, { stream: true });
              s.texto += txt;
              s.term.escrever(p.t === "err" ? "err" : "out", txt);
            });
            rolar();
          } else if (m.ev === "eco") { s.term.escrever("eco", m.texto); rolar(); }
          else if (m.ev === "espera") { s.gasto += Date.now() - s.desde; pedirEntrada(s); }
          else if (m.ev === "fim") finalizar(s, m, m.limite ? "(o programa escreveu mais de 2 MB; o editor o interrompeu)" : null);
          else if (m.ev === "falha") { s.motivo = "(o compilador do navegador falhou: " + String(m.msg).split("\n")[0] + ")"; console.error("cppsim:", m.msg); encerrarWorker(); }
          else if (m.ev === "morto") finalizar(s, null, s.motivo || "(o compilador foi reiniciado)");
        };
        s.id = enviar({ op: "executar", arquivos: arqs, nome: nome, flags: flags.split(/\s+/).filter(Boolean), args: args, stdin: stdin, interativo: stdin === null }, s.ouvinte);
      }, function () {
        if (sessao !== s) return;
        if (compilando.parentNode) compilando.parentNode.removeChild(compilando);
        sessao = null; btn.textContent = "▶ Rodar"; btn.disabled = false;
      });
    }
    btn.addEventListener("click", rodar);
  }

  function montarTudo() {
    Array.prototype.forEach.call(document.querySelectorAll(".trycpp"), function (b) {
      try { montar(b); } catch (e) { console.error("cppsim:", e); }
    });
  }
  CppSim.montarTudo = montarTudo;
  CppSim._estado = function () { return { carregado: carregado, worker: !!worker }; };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", montarTudo); else montarTudo();
})();
