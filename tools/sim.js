#!/usr/bin/env node
/* Compila e roda um .cpp como o "Experimente" do guia faria (mesmo Clang 22 em
   WebAssembly, mesma libc++, mesmo terminal). Não precisa de npm install.

   node tools/sim.js programa.cpp [argumentos…]
   node tools/sim.js programa.cpp --stdin "Ana\n29" -- arg1 arg2
   node tools/sim.js main.cpp --com conta.cpp --com conta.h --com dados.csv
   node tools/sim.js programa.cpp --flags "-std=c++17 -Wall -Wextra"

   --stdin TEXTO   entrada do programa (como data-stdin; \n = Enter). Sem --stdin o
                   programa recebe "fim de arquivo" se ler a entrada (no navegador
                   ele esperaria o leitor digitar).
   --com ARQ       outro arquivo da caixa (aba): .cpp são compilados juntos; os
                   outros ficam na pasta em que o programa roda.
   --flags "…"     opções de compilação (como data-flags; padrão -std=c++23 -Wall -Wextra).
   --sem-pch       compila sem os cabeçalhos pré-compilados (mais lento; mesmo resultado).
   --nativo        compila e roda também com o g++ 15 do laboratório e compara.
   --clang-lab     com --nativo: usa o clang++ 21 do laboratório (libstdc++) em vez do g++.
*/
"use strict";
const fs = require("fs");
const path = require("path");
const C = require("./cpp-node.js");
const Sim = require("../assets/cppsim.js");

function uso() { console.error(fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^[\s\S]*?\n\n/, "")); process.exit(2); }

async function main() {
  const a = process.argv.slice(2);
  if (!a.length || a[0] === "-h" || a[0] === "--help") uso();
  let principal = null, stdin = null, flags = Sim.FLAGS_PADRAO, nativo = false, semPch = false, clangLab = false;
  const com = [], args = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === "--") { args.push(...a.slice(i + 1)); break; }
    else if (x === "--stdin") stdin = Sim.textoEntrada(a[++i] || "");
    else if (x === "--com") com.push(a[++i]);
    else if (x === "--flags") flags = a[++i] || "";
    else if (x === "--nativo") nativo = true;
    else if (x === "--clang-lab") clangLab = true;
    else if (x === "--sem-pch") semPch = true;
    else if (!principal) principal = x;
    else args.push(x);
  }
  if (!principal) uso();
  const arquivos = [principal].concat(com).map((f) => ({ nome: path.basename(f), codigo: fs.readFileSync(f, "utf8") }));
  const cor = process.stdout.isTTY;
  const r = await C.executar(arquivos, { flags: flags.split(/\s+/).filter(Boolean), args, stdin, semPch });
  console.log("$ " + Sim.linhaCompilar(flags, arquivos));
  if (r.diag) process.stdout.write(cor ? r.diag : r.diagTexto);
  console.log((cor ? "\x1b[2m" : "") + "(compilou em " + r.msCompilacao + " ms" + (r.pch && r.pch.length ? ", PCH " + r.pch.join("+") : "") + ")" + (cor ? "\x1b[0m" : ""));
  if (!r.compilou) { console.log("[código de saída do clang++: " + r.exitCompilacao + "]"); }
  else {
    console.log("$ ./" + r.nome + (args.length ? " " + args.map(Sim.citarArg).join(" ") : ""));
    for (const e of r.eventos) {
      if (e.t === "eco") process.stdout.write(cor ? "\x1b[1m" + e.s + "\x1b[0m" : e.s);
      else if (e.t === "err") process.stdout.write(cor ? "\x1b[31m" + e.s + "\x1b[0m" : e.s);
      else process.stdout.write(e.s);
    }
    if (r.saida && !/\n$/.test(r.eventos.length ? r.eventos[r.eventos.length - 1].s : "")) process.stdout.write("\n");
    if (r.estourou) console.log("(o programa escreveu mais de 2 MB; o editor o interromperia)");
    if (r.tempoEsgotado) console.log("(o programa rodou mais de " + C.TEMPO_MAX / 1000 + " s; o editor o pararia)");
    if (r.leuSemEntrada) console.log("(o programa leu a entrada sem --stdin: recebeu fim de arquivo; no navegador ele esperaria o leitor digitar)");
    if (r.sinal) console.log(Sim.mensagemSinal(r.sinal));
    console.log("[código de saída: " + r.exit + "]");
  }
  if (nativo) {
    const Lab = require("./lab-nativo.js");
    const n = Lab.rodar(arquivos, { flags, args, stdin, compilador: clangLab ? "clang++" : "g++" });
    console.log("\n== " + n.versao + " nativo (laboratório, libstdc++)");
    if (n.diag) process.stdout.write(n.diag);
    if (!n.compilou) console.log("(não compilou)");
    else {
      console.log("[código de saída: " + n.exit + "]");
      if (r.compilou) Lab.mostrarDiferencas(r.saida, n.saida, "  ", arquivos.map((x) => x.codigo).join("\n"));
    }
  }
  C.encerrar();
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
