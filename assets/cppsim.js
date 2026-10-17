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

  if (typeof module === "object" && module.exports) { module.exports = CppSim; }
  if (typeof document === "undefined") return;
  window.CppSim = CppSim;
})();
