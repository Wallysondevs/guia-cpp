/* Compila e roda com o g++ 15 NATIVO do laboratório (~/guia-cpp-lab/lab) para
   comparar com o Clang 22 em WebAssembly do editor. Um processo por vez, timeout 60;
   o programa roda com timeout 10. Pasta pessoal própria e única por execução
   (vários autores rodam ao mesmo tempo), apagada quando o processo termina. */
"use strict";
const { spawnSync } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

const LAB = path.join(os.homedir(), "guia-cpp-lab/lab");
const NOME = "tm-" + process.pid + "-" + Math.random().toString(36).slice(2, 8);
const PASTA = path.join(os.homedir(), "guia-cpp-lab/homes", NOME);
let usada = false;
process.on("exit", () => { if (usada) { try { fs.rmSync(PASTA, { recursive: true, force: true }); } catch (e) { /* ok */ } } });
for (const sinal of ["SIGINT", "SIGTERM"]) process.on(sinal, () => process.exit(130));

function b64(s) { return Buffer.from(s, "utf8").toString("base64"); }
function q(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

/** arquivos: [{nome, codigo}]; opts: {flags: "…", args: [...], stdin: string|null, compilador: "g++"|"clang++"}
 *  → { compilou, diag, saida (stdout+stderr do programa), exit, versao } */
function rodar(arquivos, opts) {
  opts = opts || {};
  if (!fs.existsSync(LAB)) throw new Error("laboratório não encontrado em " + LAB);
  usada = true;
  const cc = opts.compilador || "g++";
  const fontes = arquivos.filter((a) => /\.(cpp|cc|cxx|c\+\+)$/i.test(a.nome)).map((a) => a.nome);
  const prog = (fontes[0] || arquivos[0].nome).replace(/^.*\//, "").replace(/\.[^.]*$/, "") || "programa";
  const flags = opts.flags === undefined || opts.flags === null ? "-std=c++23 -Wall -Wextra" : opts.flags;
  const entrada = opts.stdin !== null && opts.stdin !== undefined ? "printf %s " + q(b64(opts.stdin)) + " | base64 -d > /tmp/entrada.txt" : ": > /tmp/entrada.txt";
  const script = [
    "cd /home/ana && rm -rf ./* ./.[!.]* 2>/dev/null; cd /home/ana",
    arquivos.map((a) => 'mkdir -p "$(dirname ' + q(a.nome) + ')" && printf %s ' + q(b64(a.codigo)) + " | base64 -d > " + q(a.nome)).join("\n"),
    entrada,
    "echo @@COMPILA@@",
    cc + " " + flags + " " + fontes.map(q).join(" ") + " -o " + q(prog) + " 2>&1",
    'echo "@@CEXIT@@$?"',
    // stdbuf -oL: saída em linhas, como num terminal (senão um programa que aborta perde o que estava no buffer)
    "if [ -x " + q(prog) + " ]; then timeout 10 stdbuf -oL -eL ./" + q(prog) + " " + (opts.args || []).map(q).join(" ") + " < /tmp/entrada.txt 2>&1 | grep -v '^timeout: o comando monitorado'; echo \"@@EXIT@@${PIPESTATUS[0]}\"; fi",
    cc + " --version | head -1",
  ].join("\n");
  const r = spawnSync("timeout", ["60", LAB, "-n", NOME, "-N", "--", "bash", "-s"], { input: script, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw r.error;
  const s = r.stdout + (r.stderr || "");
  const m = /@@COMPILA@@\n([\s\S]*?)@@CEXIT@@(\d+)\n(?:([\s\S]*?)@@EXIT@@(\d+)\n)?([^\n]*)/.exec(s);
  if (!m) return { compilou: false, diag: s, saida: "", exit: null, versao: "?" };
  return { compilou: m[2] === "0", diag: m[1], saida: m[3] || "", exit: m[4] !== undefined ? +m[4] : null, versao: (m[5] || cc).replace(/^g\+\+ \(Ubuntu [^)]*\) /, "g++ ").trim() };
}

// Diferenças linha a linha (LCS simples).  "- " = editor (Clang/libc++), "+ " = nativo (g++/libstdc++)
function diferencas(a, b) {
  if (String(a) === String(b)) return [];
  const linhas = (s) => { s = String(s).replace(/\n$/, ""); return s === "" ? [] : s.split("\n").slice(0, 600); };
  const A = linhas(a), B = linhas(b);
  const n = A.length, m = B.length, L = [];
  for (let i = 0; i <= n; i++) L.push(new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const r = []; let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { r.push("+ " + B[j]); j++; }
    else { r.push("- " + A[i]); i++; }
  }
  return r;
}

// Diferenças conhecidas entre o editor (Clang + libc++ + WebAssembly 32 bits) e o g++ (libstdc++, Linux 64 bits).
const CONHECIDAS = [
  [/terminating due to uncaught exception|terminate called after throwing|^\S\s+what\(\):/, "exceção não tratada (libc++abi × libstdc++)"],
  [/^[-+] .*\b(stoi|stol|stoll|stoul|stoull|stof|stod|stold)\b/, "what() de stoi/stod (libc++: \"stoi: no conversion\"; libstdc++: \"stoi\")"],
  [/_M_range_check|basic_string::(at|substr|_M_|erase|insert|replace)|vector::at|^[-+] .*\b(vector|basic_string|string_view::substr)\s*$/, "what() de at()/substr() (mensagens da libc++ × libstdc++)"],
  [/Assertion .*failed/, "assert (wasi-libc × glibc)"],
  [/0x[0-9a-f]{3,}/i, "endereços de memória"],
  [/NSt3__2|__cxx11|St3__2/, "nomes de tipos (typeid().name(): std::__2 na libc++, std::__cxx11 na libstdc++)"],
  [/^\+ .*\bthread\b|thread constructor failed/, "std::thread (o editor não cria threads)"],
];
function classificar(dif, fonte) {
  const r = new Set();
  for (const l of dif) for (const [re, t] of CONHECIDAS) if (re.test(l)) r.add(t);
  if (fonte && /\b(uniform_int_distribution|uniform_real_distribution|normal_distribution|bernoulli_distribution|discrete_distribution|std::shuffle|random_device|rand\s*\()/.test(fonte)) r.add("números sorteados (as distribuições da libc++ e da libstdc++ dão sequências diferentes)");
  if (fonte && /\bsizeof\b|numeric_limits<\s*(long|unsigned long|size_t|std::size_t)|LONG_MAX|SIZE_MAX|ULONG_MAX/.test(fonte)) r.add("tamanhos: o WebAssembly é de 32 bits (ponteiro, long e size_t com 4 bytes; no Linux, 8)");
  if (fonte && /\b(chrono|time\s*\(|localtime|system_clock|steady_clock)\b/.test(fonte)) r.add("horário e tempo medido");
  return Array.from(r);
}

function mostrarDiferencas(wasm, nativo, prefixo, fonte) {
  prefixo = prefixo || "  ";
  const d = diferencas(wasm, nativo);
  if (!d.length) { console.log(prefixo + "saídas idênticas"); return 0; }
  const c = classificar(d, fonte);
  console.log(prefixo + "diferenças (- editor, + g++)" + (c.length ? " — esperado: " + c.join("; ") : "") + ":");
  d.slice(0, 20).forEach((l) => console.log(prefixo + "  " + l));
  if (d.length > 20) console.log(prefixo + "  … (" + (d.length - 20) + " linhas a mais)");
  return d.length;
}

module.exports = { rodar, diferencas, classificar, mostrarDiferencas, LAB };
