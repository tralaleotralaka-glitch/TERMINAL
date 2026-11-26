/* Терминал для телефона — автономный, без сети и без ссылок.
   Всё работает локально: виртуальная файловая система + каталог 500 команд. */
(() => {
  "use strict";

  /** каталог 500 команд из commands.js */
  const COMMANDS = globalThis.COMMANDS || [];

  /* ============================================================
     1. Утилиты
     ============================================================ */
  const $ = (sel) => document.querySelector(sel);
  const output = $("#output");
  const screenEl = $("#screen");
  const form = $("#promptForm");
  const input = $("#cmd");
  const promptLabel = $("#promptLabel");
  const hostTag = $("#hostTag");

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /** печать строки в экран. cls: out|dim|err|ok|warn|info|title */
  function print(text = "", cls = "out") {
    const div = document.createElement("div");
    div.className = "line " + cls;
    div.innerHTML = esc(text); // экранируем; форматирование — отдельными функциями
    output.appendChild(div);
    return div;
  }
  const printHtml = (html, cls = "out") => {
    const div = document.createElement("div");
    div.className = "line " + cls;
    div.innerHTML = html;
    output.appendChild(div);
    return div;
  };
  const blank = () => print("");

  function scrollBottom() {
    screenEl.scrollTop = screenEl.scrollHeight;
  }

  /* ============================================================
     2. Виртуальная файловая система
     ============================================================ */
  const D = (children) => ({ type: "dir", children });
  const F = (text) => ({ type: "file", text, mtime: Date.now() - 86400000 });

  const FS = D({
    home: D({
      user: D({
        "readme.md": F(
          "МИНИ-ТЕРМИНАЛ\n" +
            "=============\n\n" +
            "Это автономная песочница внутри браузера.\n" +
            "Сети нет — всё выполняется локально, на телефоне.\n\n" +
            "Что попробовать:\n" +
            "  help            — список доступных команд\n" +
            "  ?               — справочник из 500 команд\n" +
            "  neofetch        — сводка о системе\n" +
            "  tree            — дерево файлов\n" +
            "  calc 2+2*10     — калькулятор\n" +
            "  fortune         — случайная цитата\n"
        ),
        "notes.txt": F(
          "Список дел\n" +
            "----------\n" +
            "1. Открыть справочник кнопкой «?» справа сверху\n" +
            "2. Найти там команду и вставить её в строку ввода\n" +
            "3. Выполнить — Enter справа от поля\n"
        ),
        "todo.txt": F("написать свой шелл\nпрочитать man bash\n"),
        projects: D({
          "hello.sh": F('#!/bin/sh\necho "привет с телефона"\n'),
          "script.py": F('print("hello")\n'),
        }),
        downloads: D({}),
      }),
    }),
    etc: D({
      hostname: F("phone\n"),
      "os-release": F(
        'NAME="MiniTerminal"\nVERSION="1.0"\nID=miniterm\nPRETTY_NAME="MiniTerminal 1.0 (offline)"\n'
      ),
      shells: F("/bin/sh\n/bin/bash\n"),
    }),
    tmp: D({}),
    var: D({ log: D({ "system.log": F("[ok] shell started\n[ok] filesystem mounted\n") }) }),
    bin: D({}),
  });

  const HOME = ["home", "user"];
  let cwd = HOME.slice();

  const clone = (n) => JSON.parse(JSON.stringify(n));
  const cwdPath = () => "/" + cwd.join("/");

  function nodeAt(parts) {
    let n = FS;
    for (const p of parts) {
      if (!n || n.type !== "dir" || !n.children[p]) return null;
      n = n.children[p];
    }
    return n;
  }

  function normalize(path) {
    let parts;
    if (!path || path === "~") parts = HOME.slice();
    else if (path.startsWith("~/")) parts = HOME.concat(path.slice(2).split("/"));
    else if (path.startsWith("/")) parts = path.split("/");
    else parts = cwd.concat(path.split("/"));
    const out = [];
    for (const p of parts) {
      if (!p || p === ".") continue;
      if (p === "..") out.pop();
      else out.push(p);
    }
    return out;
  }

  const displayPath = (parts = cwd) => {
    const s = "/" + parts.join("/");
    const home = "/" + HOME.join("/");
    if (s === home) return "~";
    if (s.startsWith(home + "/")) return "~" + s.slice(home.length);
    return s || "/";
  };

  function parentOf(parts) {
    return { parent: nodeAt(parts.slice(0, -1)), name: parts[parts.length - 1] };
  }

  /* ============================================================
     3. Разбор строки команды (с кавычками)
     ============================================================ */
  function tokenize(str) {
    const out = [];
    let cur = "";
    let quote = null;
    let has = false;
    for (const ch of str) {
      if (quote) {
        if (ch === quote) quote = null;
        else cur += ch;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        has = true;
      } else if (ch === " " || ch === "\t") {
        if (cur || has) {
          out.push(cur);
          cur = "";
          has = false;
        }
      } else {
        cur += ch;
        has = true;
      }
    }
    if (cur || has) out.push(cur);
    return out;
  }

  /* ============================================================
     4. Калькулятор (без eval)
     ============================================================ */
  function calc(expr) {
    const src = String(expr).replace(/,/g, ".").replace(/\s+/g, "");
    if (!src) throw new Error("пустое выражение");
    if (!/^[0-9+\-*/%^().]+$/.test(src)) throw new Error("допустимы только числа и + - * / % ^ ( )");
    let i = 0;
    const peek = () => src[i];
    function number() {
      if (peek() === "(") {
        i++;
        const v = sum();
        if (peek() !== ")") throw new Error("не закрыта скобка");
        i++;
        return v;
      }
      if (peek() === "-") {
        i++;
        return -number();
      }
      if (peek() === "+") {
        i++;
        return number();
      }
      const start = i;
      while (i < src.length && /[0-9.]/.test(src[i])) i++;
      if (start === i) throw new Error("ожидалось число");
      const v = parseFloat(src.slice(start, i));
      if (Number.isNaN(v)) throw new Error("плохое число");
      return v;
    }
    function power() {
      let v = number();
      while (peek() === "^") {
        i++;
        v = Math.pow(v, number());
      }
      return v;
    }
    function term() {
      let v = power();
      while (peek() === "*" || peek() === "/" || peek() === "%") {
        const op = src[i++];
        const r = power();
        if (op === "*") v *= r;
        else if (op === "/") v /= r;
        else v %= r;
      }
      return v;
    }
    function sum() {
      let v = term();
      while (peek() === "+" || peek() === "-") {
        const op = src[i++];
        const r = term();
        v = op === "+" ? v + r : v - r;
      }
      return v;
    }
    const res = sum();
    if (i !== src.length) throw new Error("лишние символы: " + src.slice(i));
    if (!Number.isFinite(res)) throw new Error("деление на ноль?");
    return res;
  }
  const fmtNum = (n) => {
    const s = Math.abs(n) < 1e15 ? String(parseFloat(n.toFixed(10))) : n.toExponential(6);
    return s;
  };

  /* ============================================================
     5. Данные о «системе»
     ============================================================ */
  const SYS = {
    user: "user",
    host: "phone",
    os: "MiniTerminal 1.0 (offline sandbox)",
    kernel: "Linux 6.6.0-miniterm aarch64",
    uptimeStart: Date.now() - 1000 * 60 * 37,
    device: "смартфон / браузер",
    ram: 4096, // МБ
  };

  const bootTime = new Date(SYS.uptimeStart);
  const nowFixed = new Date(); // «текущее» время на момент запуска страницы

  const fmtDate = (d = new Date()) =>
    d.toLocaleString("ru-RU", {
      weekday: "short",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  function uptimeStr() {
    const s = Math.floor((Date.now() - SYS.uptimeStart) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}:${String(m).padStart(2, "0")}`;
  }

  /* ============================================================
     6. Команды
     ============================================================ */
  const history = [];
  const env = {
    HOME: "/home/user",
    USER: "user",
    SHELL: "/bin/sh",
    TERM: "xterm-256color",
    LANG: "ru_RU.UTF-8",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    PWD: "/home/user",
  };

  function cmdHelp() {
    print("Доступные команды (наберите «?» для справочника из 500 команд):");
    print("");
    const groups = [
      ["Файлы", ["ls", "cd", "pwd", "cat", "touch", "mkdir", "rm", "tree", "find", "du", "df"]],
      ["Текст", ["echo", "grep", "wc", "head", "tail", "sort", "uniq", "base64"]],
      ["Система", ["date", "uname", "whoami", "uptime", "ps", "free", "env", "history", "clear"]],
      ["Полезное", ["help", "man", "tldr", "which", "calc", "seq", "shuf", "fortune", "cowsay", "neofetch", "banner"]],
    ];
    for (const [name, list] of groups) {
      printHtml(
        `<span class="title">${esc(name)}</span>\n  ` + list.map((c) => `<span class="info">${esc(c)}</span>`).join("  ")
      );
    }
    print("");
    print("Каждой команде можно передать -h или --help.", "dim");
  }

  function cmdLs(args) {
    const long = args.includes("-l") || args.includes("-la") || args.includes("-al");
    const all = /^-.*a/.test(args.join(" ")) || args.includes("-a");
    const target = args.find((a) => !a.startsWith("-"));
    const parts = normalize(target || ".");
    const node = nodeAt(parts);
    if (!node) {
      print(`ls: нет такого файла или папки: ${target}`, "err");
      return;
    }
    if (node.type === "file") {
      print(displayPath(parts));
      return;
    }
    const names = Object.keys(node.children).sort((a, b) => a.localeCompare(b, "ru"));
    const rows = names.map((n) => ({ name: n, node: node.children[n] }));
    if (long) {
      print(`итого ${rows.length}`, "dim");
      for (const r of rows) {
        const isDir = r.node.type === "dir";
        const size = isDir ? 4096 : new Blob([r.node.text || ""]).size;
        const dt = new Date(r.node.mtime || nowFixed).toLocaleDateString("ru-RU");
        print(
          `${isDir ? "drwxr-xr-x" : "-rw-r--r--"}  ${String(size).padStart(6)}  ${dt}  ${r.name}${isDir ? "/" : ""}`,
          isDir ? "info" : "out"
        );
      }
      return;
    }
    if (!rows.length) {
      print("(пусто)", "dim");
      return;
    }
    printHtml(
      rows
        .map((r) => {
          const isDir = r.node.type === "dir";
          const label = esc(r.name) + (isDir ? "/" : "");
          return isDir ? `<span class="info">${label}</span>` : `<span>${label}</span>`;
        })
        .join("   ")
    );
    if (all && !names.length) print(".  ..", "dim");
  }

  function cmdCd(args) {
    const t = args[0] || "~";
    if (t === "-") {
      print("cd: предыдущая папка не сохранена", "err");
      return;
    }
    const parts = normalize(t);
    const n = nodeAt(parts);
    if (!n) {
      print(`cd: нет такой папки: ${t}`, "err");
      return;
    }
    if (n.type !== "dir") {
      print(`cd: это не папка: ${t}`, "err");
      return;
    }
    cwd = parts;
    env.PWD = cwdPath();
    renderPrompt();
  }

  function resolvePath(arg) {
    return normalize(arg);
  }

  function cmdCat(args) {
    if (!args.length) {
      print("cat: укажите файл", "err");
      return;
    }
    for (const a of args) {
      const parts = resolvePath(a);
      const n = nodeAt(parts);
      if (!n) print(`cat: ${a}: нет такого файла`, "err");
      else if (n.type === "dir") print(`cat: ${a}: это папка`, "err");
      else String(n.text || "").replace(/\n$/, "").split("\n").forEach((l) => print(l));
    }
  }

  function createNode(path, node) {
    const parts = resolvePath(path);
    const { parent, name } = parentOf(parts);
    if (!parent || parent.type !== "dir") {
      print(`нет папки: ${displayPath(parts.slice(0, -1))}`, "err");
      return false;
    }
    parent.children[name] = node;
    return true;
  }

  function cmdTouch(args) {
    if (!args.length) {
      print("touch: укажите имя файла", "err");
      return;
    }
    for (const a of args) {
      const parts = resolvePath(a);
      const n = nodeAt(parts);
      if (n) n.mtime = Date.now();
      else createNode(a, F(""));
    }
  }

  function cmdMkdir(args) {
    const paths = args.filter((a) => !a.startsWith("-"));
    if (!paths.length) {
      print("mkdir: укажите имя папки", "err");
      return;
    }
    for (const a of paths) {
      const parts = resolvePath(a);
      if (nodeAt(parts)) {
        print(`mkdir: ${a}: уже существует`, "err");
        continue;
      }
      createNode(a, D({}));
    }
  }

  function cmdRm(args) {
    const rec = args.some((a) => a.startsWith("-") && a.includes("r"));
    const paths = args.filter((a) => !a.startsWith("-"));
    if (!paths.length) {
      print("rm: укажите файл или папку", "err");
      return;
    }
    for (const a of paths) {
      const parts = resolvePath(a);
      const n = nodeAt(parts);
      const { parent, name } = parentOf(parts);
      if (!n || !parent) {
        print(`rm: ${a}: не найдено`, "err");
        continue;
      }
      if (n.type === "dir" && !rec) {
        print(`rm: ${a}: это папка (добавьте -r)`, "err");
        continue;
      }
      delete parent.children[name];
    }
  }

  function cmdEcho(args) {
    print(args.join(" "));
  }

  function treeLines(node, prefix = "", depth = 0, maxDepth = 3) {
    if (depth > maxDepth) return 0;
    const names = Object.keys(node.children).sort((a, b) => a.localeCompare(b, "ru"));
    let count = 0;
    names.forEach((n, idx) => {
      const last = idx === names.length - 1;
      const child = node.children[n];
      const isDir = child.type === "dir";
      printHtml(
        prefix + (last ? "└── " : "├── ") + `<span class="${isDir ? "info" : "out"}">${esc(n)}</span>` +
          (isDir ? "/" : "")
      );
      count++;
      if (isDir) count += treeLines(child, prefix + (last ? "    " : "│   "), depth + 1, maxDepth);
    });
    return count;
  }

  function cmdTree(args) {
    const t = args.find((a) => !a.startsWith("-")) || ".";
    const parts = normalize(t);
    const n = nodeAt(parts);
    if (!n || n.type !== "dir") {
      print(`tree: ${t}: не папка`, "err");
      return;
    }
    printHtml(`<span class="info">${esc(displayPath(parts))}</span>`);
    const count = treeLines(n);
    print("");
    print(`папок и файлов: ${count}`, "dim");
  }

  function walk(node, path, fileCb, dirCb) {
    for (const name of Object.keys(node.children)) {
      const child = node.children[name];
      const p = path + "/" + name;
      if (child.type === "dir") {
        dirCb && dirCb(p, child);
        walk(child, p, fileCb, dirCb);
      } else fileCb && fileCb(p, child);
    }
  }

  function cmdFind(args) {
    const pat = args.find((a) => !a.startsWith("-") && a !== ".");
    if (!pat) {
      print("find: укажите имя, например: find notes", "err");
      return;
    }
    let found = 0;
    walk(FS, "", (p) => {
      if (p.toLowerCase().includes(pat.toLowerCase().replace(/\*/g, ""))) {
        print(p);
        found++;
      }
    }, (p) => {
      if (pat.includes("*") === false && p.toLowerCase().includes(pat.toLowerCase())) {
        print(p + "/", "info");
        found++;
      }
    });
    if (!found) print("ничего не найдено", "dim");
  }

  function cmdGrep(args) {
    const pat = args.find((a) => !a.startsWith("-"));
    if (!pat) {
      print("grep: укажите шаблон", "err");
      return;
    }
    const files = args.filter((a) => !a.startsWith("-") && a !== pat);
    if (!files.length) {
      print("grep: укажите файл (например: grep привет notes.txt)", "err");
      return;
    }
    const re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    for (const f of files) {
      const n = nodeAt(resolvePath(f));
      if (!n || n.type !== "file") {
        print(`grep: ${f}: не найдено`, "err");
        continue;
      }
      String(n.text).split("\n").forEach((line) => {
        if (re.test(line)) print(`${files.length > 1 ? f + ":" : ""}${line}`, "ok");
      });
    }
  }

  function cmdWc(args) {
    const f = args.find((a) => !a.startsWith("-"));
    if (!f) {
      print("wc: укажите файл", "err");
      return;
    }
    const n = nodeAt(resolvePath(f));
    if (!n || n.type !== "file") {
      print(`wc: ${f}: нет такого файла`, "err");
      return;
    }
    const text = String(n.text);
    const lines = text.split("\n").filter(Boolean).length;
    const words = text.split(/\s+/).filter(Boolean).length;
    const bytes = new Blob([text]).size;
    print(`${lines} ${words} ${bytes} ${f}`);
  }

  function cmdHeadTail(args, head) {
    const f = args.find((a) => !a.startsWith("-"));
    const nArg = args.find((a) => /^-\d+$/.test(a));
    const count = nArg ? Math.abs(parseInt(nArg, 10)) : 10;
    if (!f) {
      print(`${head ? "head" : "tail"}: укажите файл`, "err");
      return;
    }
    const node = nodeAt(resolvePath(f));
    if (!node || node.type !== "file") {
      print(`${head ? "head" : "tail"}: ${f}: нет такого файла`, "err");
      return;
    }
    const lines = String(node.text).replace(/\n$/, "").split("\n");
    const slice = head ? lines.slice(0, count) : lines.slice(-count);
    slice.forEach((l) => print(l));
  }

  function cmdSort(args) {
    const f = args.find((a) => !a.startsWith("-"));
    const x = nodeAt(resolvePath(f));
    if (!x || x.type !== "file") {
      print("sort: укажите файл", "err");
      return;
    }
    String(x.text)
      .split("\n")
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "ru"))
      .forEach((l) => print(l));
  }

  function cmdUniq(args) {
    const f = args.find((a) => !a.startsWith("-"));
    const x = nodeAt(resolvePath(f));
    if (!x || x.type !== "file") {
      print("uniq: укажите файл", "err");
      return;
    }
    const lines = String(x.text).split("\n");
    lines.forEach((l, i) => {
      if (i === 0 || l !== lines[i - 1]) print(l);
    });
  }

  function cmdBase64(args) {
    const dec = args.includes("-d");
    const body = args.filter((a) => !a.startsWith("-")).join(" ");
    if (!body) {
      print("base64: укажите текст", "err");
      return;
    }
    try {
      if (dec) print(decodeURIComponent(escape(atob(body))));
      else print(btoa(unescape(encodeURIComponent(body))));
    } catch {
      print("base64: неверные данные", "err");
    }
  }

  function cmdDu(args) {
    const parts = normalize(args.find((a) => !a.startsWith("-")) || ".");
    const n = nodeAt(parts);
    if (!n) {
      print("du: нет такого пути", "err");
      return;
    }
    const sizeOf = (node) => {
      if (node.type === "file") return new Blob([node.text || ""]).size;
      return Object.values(node.children).reduce((s, c) => s + 1 + sizeOf(c), 0);
    };
    if (n.type === "dir") {
      const rows = Object.keys(n.children).map((k) => [k, sizeOf(n.children[k])]);
      rows.sort((a, b) => b[1] - a[1]);
      for (const [k, s] of rows) print(`${String(s).padStart(6)}  ${displayPath(parts)}/${k}`);
      print(`${String(sizeOf(n)).padStart(6)}  ${displayPath(parts)} (всего)`, "dim");
    } else print(`${String(new Blob([n.text]).size).padStart(6)}  ${displayPath(parts)}`);
  }

  function cmdDf() {
    printHtml(
      `<table class="tbl"><tr><th>ФС</th><th>Размер</th><th>Занято</th><th>Свободно</th><th>%</th></tr>` +
        `<tr><td>/</td><td>64G</td><td>12G</td><td>52G</td><td>19%</td></tr>` +
        `<tr><td>/data</td><td>110G</td><td>48G</td><td>62G</td><td>44%</td></tr>` +
        `<tr><td>/tmp</td><td>2G</td><td>4M</td><td>2G</td><td>1%</td></tr></table>`
    );
    print("(виртуальные значения песочницы)", "dim");
  }

  function cmdFree() {
    printHtml(
      `<table class="tbl"><tr><th></th><th>всего</th><th>занято</th><th>свободно</th></tr>` +
        `<tr><td>Mem</td><td>${SYS.ram} МБ</td><td>1482 МБ</td><td>${SYS.ram - 1482} МБ</td></tr>` +
        `<tr><td>Swap</td><td>1024 МБ</td><td>0 МБ</td><td>1024 МБ</td></tr></table>`
    );
  }

  const PROCS = [
    ["1", "init", "0.0", "1.2"],
    ["42", "sh", "0.0", "2.4"],
    ["128", "termux", "0.3", "12.8"],
    ["256", "node", "1.1", "38.5"],
    ["512", "sshd", "0.0", "3.1"],
  ];

  function cmdPs() {
    printHtml(
      `<table class="tbl"><tr><th>PID</th><th>CMD</th><th>CPU%</th><th>MEM%</th></tr>` +
        PROCS.map(
          (p) => `<tr><td>${p[0]}</td><td class="desc">${esc(p[1])}</td><td>${p[2]}</td><td>${p[3]}</td></tr>`
        ).join("") +
        `</table>`
    );
  }

  function cmdKill(args) {
    const pid = args[0];
    if (!pid) {
      print("kill: укажите PID (ps покажет список)", "err");
      return;
    }
    const p = PROCS.find((x) => x[0] === pid);
    if (!p) print(`kill: ${pid}: такого процесса нет`, "err");
    else if (p[1] === "init") print("kill: отказано: процесс 1 защищён", "err");
    else print(`процесс ${pid} (${p[1]}) завершён`, "warn");
  }

  function cmdDate() {
    print(fmtDate());
    print("часовой пояс: локальный (UTC+3, Москва)", "dim");
  }

  function cmdUname(a) {
    if (a.includes("-a")) print(`${SYS.kernel} #1 SMP PREEMPT ${SYS.device}`);
    else print("Linux");
  }

  function cmdNeofetch() {
    const art = [
      "   ▄▄▄▄▄▄▄   ",
      "  █ ▄▄▄▄▄ █  ",
      "  █ █▀▀▀█ █  ",
      "  █ █▄▄▄█ █  ",
      "  █▄▄▄▄▄▄▄█  ",
      "   ▀▀▀▀▀▀▀   ",
    ];
    const info = [
      ["user", SYS.user + "@" + SYS.host],
      ["OS", SYS.os],
      ["Kernel", SYS.kernel],
      ["Uptime", uptimeStr()],
      ["Shell", "mtsh 1.0"],
      ["Terminal", "MiniTerminal (web)"],
      ["CPU", "ARM64 · 8 ядер"],
      ["Memory", "1482 МБ / " + SYS.ram + " МБ"],
      ["Команд", String(COMMANDS.length)],
    ];
    const rows = Math.max(art.length, info.length);
    for (let i = 0; i < rows; i++) {
      const left = (art[i] || "             ").padEnd(14, " ");
      const right = info[i] ? `${info[i][0]}: ${info[i][1]}` : "";
      printHtml(`<span class="ok">${esc(left)}</span><span class="${info[i] && i === 0 ? "info" : "out"}">${esc(right)}</span>`);
    }
    printHtml(
      ["#57e08b", "#5cc8ff", "#ffc857", "#ff6b6b", "#b48cff", "#8ea0b8"]
        .map((c) => `<span style="color:${c}">███</span>`)
        .join("")
    );
  }

  const FORTUNES = [
    "Терпение и труд перетрут любой дедлайн.",
    "Сначала прочитайте ошибку. Потом удивляйтесь.",
    "rm -rf — это не способ решить проблему, это способ решить её окончательно.",
    "Лучший код — тот, который не пришлось писать.",
    "git commit — маленький шаг для человека, огромный шаг для отладки.",
    "Если сомневаетесь — сделайте бэкап. Если не сомневаетесь — сделайте два.",
    "Комментарий «временное решение» живёт дольше, чем сервер.",
    "Документация — это письмо себе в будущее.",
    "На телефоне тоже можно писать код. Просто медленнее и с большим числом опечаток.",
  ];
  const cmdFortune = () => print(FORTUNES[Math.floor(Math.random() * FORTUNES.length)], "ok");

  function cmdCowsay(args) {
    const msg = args.join(" ") || "привет";
    const line = "_".repeat(msg.length + 2);
    print(" " + line, "info");
    print("< " + msg + " >", "info");
    print(" " + "-".repeat(msg.length + 2), "info");
    print("        \\   ^__^");
    print("         \\  (oo)\\_______");
    print("            (__)\\       )\\/\\");
    print("                ||----w |");
    print("                ||     ||");
  }

  const BIG = {
    A: [" █ ", "█ █", "███", "█ █", "█ █"], B: ["██ ", "█ █", "██ ", "█ █", "██ "],
    C: ["███", "█  ", "█  ", "█  ", "███"], D: ["██ ", "█ █", "█ █", "█ █", "██ "],
    E: ["███", "█  ", "██ ", "█  ", "███"], F: ["███", "█  ", "██ ", "█  ", "█  "],
    G: ["███", "█  ", "█ █", "█ █", "███"], H: ["█ █", "█ █", "███", "█ █", "█ █"],
    I: ["███", " █ ", " █ ", " █ ", "███"], J: ["  █", "  █", "  █", "█ █", "███"],
    K: ["█ █", "█ █", "██ ", "█ █", "█ █"], L: ["█  ", "█  ", "█  ", "█  ", "███"],
    M: ["█ █", "███", "███", "█ █", "█ █"], N: ["█ █", "███", "███", "███", "█ █"],
    O: ["███", "█ █", "█ █", "█ █", "███"], P: ["██ ", "█ █", "██ ", "█  ", "█  "],
    Q: ["███", "█ █", "█ █", "███", "  █"], R: ["██ ", "█ █", "██ ", "█ █", "█ █"],
    S: ["███", "█  ", "███", "  █", "███"], T: ["███", " █ ", " █ ", " █ ", " █ "],
    U: ["█ █", "█ █", "█ █", "█ █", "███"], V: ["█ █", "█ █", "█ █", "█ █", " █ "],
    W: ["█ █", "█ █", "███", "███", "█ █"], X: ["█ █", "█ █", " █ ", "█ █", "█ █"],
    Y: ["█ █", "█ █", " █ ", " █ ", " █ "], Z: ["███", "  █", " █ ", "█  ", "███"],
    " ": ["   ", "   ", "   ", "   ", "   "], "!": [" █ ", " █ ", " █ ", "   ", " █ "],
  };
  const TRANSLIT = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
    й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
    у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
    э: "e", ю: "yu", я: "ya",
  };
  const toLatin = (s) =>
    s
      .toLowerCase()
      .split("")
      .map((c) => (TRANSLIT[c] !== undefined ? TRANSLIT[c] : c))
      .join("")
      .toUpperCase();

  /** 5 строк блочного «баннера» */
  function bigArt(text, limit = 14) {
    const rows = ["", "", "", "", ""];
    for (const ch of toLatin(text).slice(0, limit)) {
      const g = BIG[ch] || BIG[" "];
      for (let i = 0; i < 5; i++) rows[i] += (g[i] || "   ") + " ";
    }
    return rows;
  }

  function cmdBanner(args) {
    const text = args.join(" ") || "terminal";
    bigArt(text).forEach((r) => print(r.replace(/\s+$/, ""), "ok"));
  }

  function cmdSeq(args) {
    let [a, b, stepRaw] = args;
    let start = 1, end, step = 1;
    if (b !== undefined) {
      start = Number(a);
      end = Number(b);
      if (stepRaw !== undefined) step = Number(stepRaw);
    } else if (a !== undefined) end = Number(a);
    else {
      print("seq: укажите число", "err");
      return;
    }
    if (![start, end, step].every((n) => Number.isFinite(n)) || step === 0) {
      print("seq: нужны числа, шаг не ноль", "err");
      return;
    }
    const out = [];
    for (let v = start; step > 0 ? v <= end : v >= end; v += step) {
      out.push(fmtNum(v));
      if (out.length >= 1000) break;
    }
    print(out.join("\n"));
  }

  function cmdShuf(args) {
    const n = parseInt(args[0], 10);
    if (Number.isFinite(n) && n > 0) {
      const arr = Array.from({ length: Math.min(n, 1000) }, (_, i) => i + 1);
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      print(arr.join("\n"));
      return;
    }
    print("shuf: укажите количество, например: shuf 6", "err");
  }

  function cmdHistory() {
    if (!history.length) {
      print("история пуста", "dim");
      return;
    }
    history.forEach((h, i) => print(`${String(i + 1).padStart(3)}  ${h}`));
  }

  function cmdEnv() {
    Object.entries(env).forEach(([k, v]) => print(`${k}=${v}`));
  }

  function cmdExport(args) {
    if (!args.length) {
      cmdEnv();
      return;
    }
    const a = args[0];
    const eq = a.indexOf("=");
    if (eq < 1) {
      print("export: формат ИМЯ=значение", "err");
      return;
    }
    env[a.slice(0, eq)] = a.slice(eq + 1);
    print(`задано: ${a.slice(0, eq)}`, "dim");
  }

  function cmdWhich(args) {
    const name = args[0];
    if (!name) {
      print("which: укажите команду", "err");
      return;
    }
    if (!KNOWN.has(name)) {
      print(`which: ${name}: не найдено`, "err");
      return;
    }
    print(`/usr/bin/${name}`);
  }

  function cmdMan(args) {
    const name = args[0];
    if (!name) {
      print("man: укажите команду, например: man ls", "err");
      return;
    }
    const entry = CATALOG_BY_NAME.get(name);
    if (!entry) {
      print(`man: ничего не найдено по «${name}»`, "err");
      print("подсказка: откройте справочник кнопкой «?»", "dim");
      return;
    }
    print(`${name.toUpperCase()}(1)`, "title");
    print("");
    print(`НАЗВАНИЕ`, "title");
    print(`    ${entry.desc}`);
    print("");
    print(`КАТЕГОРИЯ`, "title");
    print(`    ${entry.cat}`);
    print("");
    print(`ПРИМЕР`, "title");
    print(`    $ ${name}`);
    print("");
    print(`ОПИСАНИЕ`, "title");
    print(`    Команда из справочника на ${COMMANDS.length} штук. В этой песочнице`);
    print(`    реально выполняются только встроенные команды (см. help).`, "dim");
  }

  function cmdTldr(args) {
    const name = args[0];
    if (!name) {
      print("tldr: укажите команду, например: tldr tar", "err");
      return;
    }
    const entry = CATALOG_BY_NAME.get(name);
    if (!entry) {
      print(`tldr: нет страницы для «${name}»`, "err");
      return;
    }
    print(`# ${name}`, "title");
    print("");
    print(`> ${entry.desc}`);
    print("");
    print(`- базовый вызов:`, "dim");
    print(`  ${name}`);
  }

  function cmdClear() {
    output.innerHTML = "";
  }

  function cmdOffline(name) {
    print(`${name}: эта песочница работает офлайн, без сети.`, "warn");
    print("Все данные — локальная виртуальная файловая система.", "dim");
  }

  function cmdSleep(args) {
    const s = Number(args[0]);
    if (!Number.isFinite(s) || s < 0) {
      print("sleep: укажите секунды", "err");
      return;
    }
    if (s > 5) {
      print(`sleep: максимум 5 секунд в песочнице (запрошено ${s})`, "warn");
      return;
    }
    print(`ждём ${s} c…`, "dim");
  }

  function cmdYes(args) {
    const txt = args.join(" ") || "y";
    for (let i = 0; i < 12; i++) print(txt);
    print("… (обрезано до 12 строк)", "dim");
  }

  function cmdPwd() {
    print(cwdPath());
  }

  function cmdWhoami() {
    print(SYS.user);
  }

  function cmdHostname() {
    print(SYS.host);
  }

  function cmdUptime() {
    print(` ${fmtDate()}  up ${uptimeStr()},  1 user,  load average: 0.12, 0.20, 0.18`);
  }

  function cmdId() {
    print("uid=10000(user) gid=10000(user) groups=10000(user),3003(inet)");
  }

  /* ---------- реестр встроенных команд ---------- */
  const BUILTIN = {
    help: () => cmdHelp(),
    "?": () => openSheet(),
    cmds: () => cmdCatalog(),
    commands: () => cmdCatalog(),
    clear: () => cmdClear(),
    reset: () => cmdClear(),
    ls: cmdLs,
    dir: cmdLs,
    cd: cmdCd,
    pwd: cmdPwd,
    cat: cmdCat,
    less: cmdCat,
    more: cmdCat,
    touch: cmdTouch,
    mkdir: cmdMkdir,
    rm: cmdRm,
    rmdir: cmdRm,
    echo: cmdEcho,
    tree: cmdTree,
    find: cmdFind,
    grep: cmdGrep,
    wc: cmdWc,
    head: (a) => cmdHeadTail(a, true),
    tail: (a) => cmdHeadTail(a, false),
    sort: cmdSort,
    uniq: cmdUniq,
    base64: cmdBase64,
    du: cmdDu,
    df: cmdDf,
    free: cmdFree,
    ps: cmdPs,
    top: () => cmdPs(),
    kill: cmdKill,
    date: cmdDate,
    uname: cmdUname,
    uptime: cmdUptime,
    whoami: cmdWhoami,
    id: cmdId,
    hostname: cmdHostname,
    neofetch: cmdNeofetch,
    screenfetch: cmdNeofetch,
    fortune: cmdFortune,
    cowsay: cmdCowsay,
    banner: cmdBanner,
    figlet: cmdBanner,
    seq: cmdSeq,
    shuf: cmdShuf,
    history: cmdHistory,
    env: cmdEnv,
    printenv: cmdEnv,
    export: cmdExport,
    which: cmdWhich,
    type: cmdWhich,
    man: cmdMan,
    tldr: cmdTldr,
    info: cmdMan,
    calc: (a) => {
      if (!a.length) {
        print("calc: укажите выражение, например: calc 2*(3+4)", "err");
        return;
      }
      try {
        print(fmtNum(calc(a.join(" "))));
      } catch (e) {
        print("calc: " + e.message, "err");
      }
    },
    bc: (a) => BUILTIN.calc(a),
    expr: (a) => BUILTIN.calc(a),
    sleep: cmdSleep,
    yes: cmdYes,
    true: () => {},
    false: () => print("", "dim"),
    who: () => print(`${SYS.user}   tty1    ${fmtDate()} (localhost)`),
    w: () => print(`${SYS.user}   tty1    ${fmtDate()}  0.01s 0.02s mtsh`),
    last: () => print(`${SYS.user}  tty1  ${fmtDate()}  still logged in`),
    unlink: (a) => cmdRm(a),
    cp: (a) => cmdCp(a),
    mv: (a) => cmdMv(a),
    ln: (a) => cmdCp(a),
    stat: (a) => cmdStat(a),
    file: (a) => cmdFile(a),
    hexdump: () => cmdOffline("hexdump"),
    ping: () => cmdOffline("ping"),
    curl: () => cmdOffline("curl"),
    wget: () => cmdOffline("wget"),
    ssh: () => cmdOffline("ssh"),
    dig: () => cmdOffline("dig"),
    nmap: () => cmdOffline("nmap"),
    sudo: () => print("sudo: вы и так единственный пользователь песочницы 🙂", "warn"),
    su: () => print("su: смена пользователя недоступна в песочнице", "err"),
    exit: () => print("выход из оболочки невозможен: вы уже дома. Наберите clear, чтобы очистить экран.", "warn"),
    logout: () => print("logout: сессия не завершается в браузере", "warn"),
    alias: () => print("alias: сокращения в этой версии не поддерживаются", "dim"),
    bash: () => print("bash: вложенная оболочка не поддерживается", "dim"),
    sh: () => print("sh: вложенная оболочка не поддерживается", "dim"),
    vim: () => print("vim: редактор недоступен в веб-песочнице", "dim"),
    nano: () => print("nano: редактор недоступен в веб-песочнице", "dim"),
  };

  function cmdCp(args) {
    const src = args[0];
    const dst = args[1];
    if (!src || !dst) {
      print("cp: cp источник назначение", "err");
      return;
    }
    const s = nodeAt(resolvePath(src));
    if (!s) {
      print(`cp: ${src}: не найдено`, "err");
      return;
    }
    const dstParts = resolvePath(dst);
    const dNode = nodeAt(dstParts);
    let targetParts = dstParts;
    if (dNode && dNode.type === "dir") targetParts = dstParts.concat(src.split("/").pop());
    const copy = clone(s);
    createNode("/" + targetParts.join("/"), copy) && print(`скопировано: ${src} → ${dst}`, "dim");
  }

  function cmdMv(args) {
    const [src, dst] = args;
    if (!src || !dst) {
      print("mv: mv источник назначение", "err");
      return;
    }
    const sParts = resolvePath(src);
    const s = nodeAt(sParts);
    if (!s) {
      print(`mv: ${src}: не найдено`, "err");
      return;
    }
    let dstParts = resolvePath(dst);
    const dNode = nodeAt(dstParts);
    if (dNode && dNode.type === "dir") dstParts = dstParts.concat(sParts[sParts.length - 1]);
    if (createNode("/" + dstParts.join("/"), clone(s))) {
      const { parent, name } = parentOf(sParts);
      delete parent.children[name];
      print(`перемещено: ${src} → ${dst}`, "dim");
    }
  }

  function cmdStat(args) {
    const f = args[0];
    const n = f && nodeAt(resolvePath(f));
    if (!n) {
      print("stat: укажите существующий файл", "err");
      return;
    }
    const isDir = n.type === "dir";
    printHtml(
      `<dl class="kv">` +
        `<dt>Файл</dt><dd>${esc(displayPath(resolvePath(f)))}</dd>` +
        `<dt>Тип</dt><dd>${isDir ? "папка" : "обычный файл"}</dd>` +
        `<dt>Размер</dt><dd>${isDir ? 4096 : new Blob([n.text || ""]).size} байт</dd>` +
        `<dt>Доступ</dt><dd>${isDir ? "drwxr-xr-x" : "-rw-r--r--"}</dd>` +
        `<dt>Владелец</dt><dd>user:user</dd>` +
        `<dt>Изменён</dt><dd>${esc(new Date(n.mtime || nowFixed).toLocaleString("ru-RU"))}</dd>` +
        `</dl>`
    );
  }

  function cmdFile(args) {
    const f = args[0];
    const n = f && nodeAt(resolvePath(f));
    if (!n) {
      print("file: укажите файл", "err");
      return;
    }
    if (n.type === "dir") print(`${f}: directory`);
    else if (/^#!/.test(n.text)) print(`${f}: shell script, ASCII text executable`);
    else print(`${f}: ASCII text`);
  }

  function cmdCatalog() {
    print(`В каталоге ${COMMANDS.length} команд.`, "ok");
    const byCat = {};
    for (const c of COMMANDS) (byCat[c[2]] ||= []).push(c[0]);
    for (const [cat, list] of Object.entries(byCat)) {
      printHtml(`<span class="title">${esc(cat)}</span> <span class="dim">(${list.length})</span>`);
      printHtml("  " + list.map((n) => `"${esc(n)}"`).join(", "));
    }
    print("");
    print("Полный справочник с поиском — кнопка «?» справа сверху.", "dim");
  }

  const KNOWN = new Set(Object.keys(BUILTIN));

  /* ============================================================
     7. Каталог команд (500 шт.)
     ============================================================ */
  const CATALOG_BY_NAME = new Map();
  const CATEGORIES = [];
  (function buildIndex() {
    for (const [name, desc, cat] of COMMANDS) {
      CATALOG_BY_NAME.set(name, { name, desc, cat });
      if (!CATEGORIES.includes(cat)) CATEGORIES.push(cat);
    }
  })();
  const CATALOG_NAMES = COMMANDS.map((c) => c[0]).concat([...KNOWN]);

  /* ============================================================
     8. Выполнение команды
     ============================================================ */
  function execute(raw) {
    const line = raw.trim();
    if (!line) return;

    // эхо команды в потоке
    const echo = document.createElement("div");
    echo.className = "line echo";
    echo.innerHTML = `<span class="echo-txt">${esc(displayPath())}</span> <span>${esc(line)}</span>`;
    output.appendChild(echo);
    const before = output.children.length;

    // конвейер не поддерживаем, но подскажем
    if (line.includes("|")) {
      print("конвейеры | в песочнице не поддерживаются", "warn");
      print("подсказка: вывод команд можно посмотреть отдельно", "dim");
      return;
    }
    if (line.includes(">") || line.includes(">>")) {
      print("перенаправление > не поддерживается в песочнице", "warn");
      return;
    }

    const args = tokenize(line);
    const name = args[0];
    const rest = args.slice(1);

    if (rest.includes("--help") || rest.includes("-h")) {
      printHelpFor(name);
      return;
    }

    const fn = BUILTIN[name];
    if (fn) {
      try {
        fn(rest);
      } catch (e) {
        print(`${name}: ошибка: ${e.message}`, "err");
      }
      return;
    }

    if (CATALOG_BY_NAME.has(name)) {
      const e = CATALOG_BY_NAME.get(name);
      print(`${name}: ${e.desc}.`, "info");
      print(`категория: ${e.cat}`, "dim");
      print("");
      print(`В этой песочнице команда не выполняется — она только в справочнике.`, "dim");
      print(`man ${name} — карточка, tldr ${name} — кратко.`, "dim");
      return;
    }

    // опечатка? подскажем похожие
    print(`${name}: команда не найдена`, "err");
    const prefix = name.slice(0, 2);
    const near = prefix ? CATALOG_NAMES.filter((c) => c.startsWith(prefix)).slice(0, 6) : [];
    if (near.length) print("похожие: " + near.join(", "), "dim");
    else print("наберите help — список встроенных, «?» — все 500 команд", "dim");
  }

  function printHelpFor(name) {
    const e = CATALOG_BY_NAME.get(name);
    if (!e) {
      print(`--help: для «${name}» нет справки`, "err");
      return;
    }
    print(`${e.name} — ${e.desc}`);
    print(`категория: ${e.cat}`, "dim");
    if (BUILTIN[name]) print(`доступна в песочнице: да`, "ok");
    else print(`доступна в песочнице: нет`, "warn");
  }

  /* ============================================================
     9. Строка ввода: история, Tab, клавиши
     ============================================================ */
  let histIdx = -1;
  let draft = "";

  function renderPrompt() {
    promptLabel.textContent = displayPath() + " $";
    input.placeholder = "введите команду";
  }

  function submit() {
    const value = input.value;
    input.value = "";
    if (value.trim()) {
      history.push(value.trim());
      histIdx = -1;
      draft = "";
    }
    execute(value);
    scrollBottom();
    input.focus({ preventScroll: true });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
    scrollBottom();
  });

  function setInput(val) {
    input.value = val;
    input.focus({ preventScroll: true });
    const len = input.value.length;
    try {
      input.setSelectionRange(len, len);
    } catch {}
  }

  function complete() {
    const val = input.value;
    const parts = val.split(" ");
    const last = parts[parts.length - 1];
    let candidates = [];

    if (parts.length === 1) {
      candidates = CATALOG_NAMES.filter((c) => c.startsWith(last));
    } else {
      // дополнение путей
      const segs = last.split("/");
      const base = segs.slice(0, -1).join("/");
      const frag = segs[segs.length - 1];
      const dirParts = normalize(base || ".");
      const dir = nodeAt(dirParts);
      if (dir && dir.type === "dir") {
        candidates = Object.keys(dir.children)
          .filter((n) => n.startsWith(frag))
          .map((n) => {
            const isDir = dir.children[n].type === "dir";
            return (base ? base + "/" : "") + n + (isDir ? "/" : "");
          });
      }
    }

    if (!candidates.length) return;
    if (candidates.length === 1) {
      parts[parts.length - 1] = candidates[0];
      setInput(parts.join(" "));
      return;
    }
    // общий префикс
    let common = candidates[0];
    for (const c of candidates) {
      let i = 0;
      while (i < common.length && i < c.length && common[i] === c[i]) i++;
      common = common.slice(0, i);
    }
    if (common.length > last.length) {
      parts[parts.length - 1] = common;
      setInput(parts.join(" "));
    }
    printHtml(
      candidates
        .slice(0, 40)
        .map((c) => `<span class="info">${esc(c)}</span>`)
        .join("   ") + (candidates.length > 40 ? ` <span class="dim">… ещё ${candidates.length - 40}</span>` : "")
    );
    scrollBottom();
  }

  const keys = $("#keys");
  keys.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-key]");
    if (!btn) return;
    const k = btn.dataset.key;
    if (k === "tab") {
      complete();
      return;
    }
    if (k === "esc") {
      if (!sheet.hidden) closeSheet();
      else input.blur();
      return;
    }
    if (k === "ctrlc") {
      setInput("");
      print("^C", "warn");
      scrollBottom();
      return;
    }
    if (k === "up") {
      stepHistory(-1);
      return;
    }
    if (k === "down") {
      stepHistory(1);
      return;
    }
    const map = { "*": "&" };
    setInput(input.value + (map[k] || k));
    scrollBottom();
  });

  function stepHistory(dir) {
    if (!history.length) return;
    if (histIdx === -1) draft = input.value;
    if (dir < 0) {
      histIdx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
    } else {
      if (histIdx === -1) return;
      histIdx += 1;
      if (histIdx >= history.length) {
        histIdx = -1;
        setInput(draft);
        return;
      }
    }
    setInput(history[histIdx]);
  }

  /* ============================================================
     10. Справочник (кнопка «?»)
     ============================================================ */
  const sheet = $("#sheet");
  const sheetList = $("#list");
  const search = $("#search");
  const chips = $("#chips");
  const sheetCount = $("#sheetCount");
  const clearSearchBtn = $("#clearSearch");
  let activeCat = "all";
  let lastFocus = null;

  function buildChips() {
    const items = [{ id: "all", label: "Все" }].concat(CATEGORIES.map((c) => ({ id: c, label: c })));
    chips.innerHTML = items
      .map(
        (c) =>
          `<button class="chip" type="button" data-cat="${esc(c.id)}" aria-pressed="${c.id === activeCat}">${esc(
            c.label
          )}</button>`
      )
      .join("");
  }

  function highlight(text, q) {
    if (!q) return esc(text);
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return esc(text);
    return (
      esc(text.slice(0, idx)) +
      "<mark>" +
      esc(text.slice(idx, idx + q.length)) +
      "</mark>" +
      esc(text.slice(idx + q.length))
    );
  }

  function renderList() {
    const q = search.value.trim().toLowerCase();
    clearSearchBtn.hidden = !q;
    const items = COMMANDS.filter(([name, desc, cat]) => {
      if (activeCat !== "all" && cat !== activeCat) return false;
      if (!q) return true;
      return name.toLowerCase().includes(q) || desc.toLowerCase().includes(q) || cat.toLowerCase().includes(q);
    });

    sheetCount.textContent =
      `${items.length} ${plural(items.length, "команда", "команды", "команд")}` +
      (items.length === COMMANDS.length ? " · весь справочник" : ` из ${COMMANDS.length}`);

    if (!items.length) {
      sheetList.innerHTML = `<div class="empty">Ничего не найдено.<br>Попробуйте «git», «архив» или «сеть».</div>`;
      return;
    }

    const groups = new Map();
    for (const it of items) {
      if (!groups.has(it[2])) groups.set(it[2], []);
      groups.get(it[2]).push(it);
    }

    let html = "";
    for (const [cat, list] of groups) {
      html += `<div class="cat-head">${esc(cat)}<span>${list.length} ${plural(list.length, "команда", "команды", "команд")}</span></div>`;
      for (const [name, desc] of list) {
        html +=
          `<button class="cmd-item" type="button" data-cmd="${esc(name)}" data-cat="${esc(cat)}">` +
          `<span class="ci-name">${highlight(name, q)}</span>` +
          `<span class="ci-desc">${highlight(desc, q)}</span>` +
          `</button>`;
      }
    }
    sheetList.innerHTML = html;
  }

  function plural(n, one, few, many) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function openSheet() {
    lastFocus = document.activeElement;
    sheet.hidden = false;
    document.body.style.overflow = "hidden";
    renderList();
    // мягкий фокус на поиск только на больших экранах (на телефоне не выскакивает клавиатура)
    try {
      if (window.matchMedia && window.matchMedia("(min-width:640px)").matches) search.focus();
    } catch {}
    sheetList.scrollTop = 0;
  }

  function closeSheet() {
    sheet.hidden = true;
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    else input.focus({ preventScroll: true });
  }

  $("#helpBtn").addEventListener("click", openSheet);
  $("#closeSheet").addEventListener("click", closeSheet);
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) closeSheet();
  });

  search.addEventListener("input", () => {
    if (search.value.trim() && activeCat !== "all") {
      // при вводе ищем по всему справочнику — так удобнее
      activeCat = "all";
      [...chips.children].forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.cat === "all")));
      chips.querySelector('[data-cat="all"]').scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    renderList();
    sheetList.scrollTop = 0;
  });
  clearSearchBtn.addEventListener("click", () => {
    search.value = "";
    renderList();
    search.focus();
  });

  chips.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    activeCat = btn.dataset.cat;
    if (search.value) {
      search.value = "";
      clearSearchBtn.hidden = true;
    }
    [...chips.children].forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.cat === activeCat)));
    renderList();
    sheetList.scrollTop = 0;
  });

  sheetList.addEventListener("click", (e) => {
    const item = e.target.closest(".cmd-item");
    if (!item) return;
    const cmd = item.dataset.cmd;
    closeSheet();
    setInput(cmd);
    scrollBottom();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !sheet.hidden) {
      e.preventDefault();
      closeSheet();
    }
    if (e.key === "/" && sheet.hidden && document.activeElement !== input && document.activeElement !== search) {
      e.preventDefault();
      input.focus();
    }
  });

  /* Tab и стрелки прямо в поле ввода */
  input.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      complete();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      stepHistory(-1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      stepHistory(1);
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      cmdClear();
    } else if (e.key === "c" && e.ctrlKey) {
      e.preventDefault();
      const v = input.value;
      input.value = "";
      if (v) {
        const echo = document.createElement("div");
        echo.className = "line echo";
        echo.innerHTML = `<span class="echo-txt">${esc(displayPath())}</span><span class="echo-txt"> ${esc(v)}</span>`;
        output.appendChild(echo);
        print("^C", "warn");
        scrollBottom();
      }
    }
  });

  /* ============================================================
     11. Загрузка
     ============================================================ */
  function welcome() {
    bigArt("MINITERM", 8).forEach((r) =>
      printHtml(`<span class="banner-line">${esc(r.replace(/\s+$/, ""))}</span>`)
    );
    print("");
    printHtml(`<span class="ok">MiniTerminal 1.0</span> <span class="dim">· автономная песочница</span>`);
    printHtml(`<span class="dim">Офлайн. Никаких ссылок — только телефон и консоль.</span>`);
    print("");
    printHtml(
      `<span class="dim">Справочник:</span> <span class="info">${COMMANDS.length} команд</span> <span class="dim">— кнопка</span> <span class="ok">?</span> <span class="dim">в правом верхнем углу.</span>`
    );
    printHtml(`<span class="dim">Начало работы:</span> <span class="info">help</span> <span class="dim">·</span> <span class="info">neofetch</span> <span class="dim">·</span> <span class="info">tree</span> <span class="dim">·</span> <span class="info">calc 2+2*10</span>`);

    const card = document.createElement("div");
    card.className = "hint-card";
    card.innerHTML =
      `<div class="hc-title">Быстрый старт</div>` +
      [
        ["help", "встроенные команды"],
        ["?", "все 500 команд"],
        ["man grep", "карточка команды"],
        ["neofetch", "сводка о системе"],
      ]
        .map(([c, d]) => `<button type="button" data-run="${esc(c)}">${esc(c)}<span>${esc(d)}</span></button>`)
        .join("");
    output.appendChild(card);
    card.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-run]");
      if (!b) return;
      setInput(b.dataset.run);
      scrollBottom();
    });
    print("");
    print(`Подсказка: ↑ ↓ — история, Tab — автодополнение.`, "dim");
  }

  hostTag.textContent = "localhost";
  renderPrompt();
  buildChips();
  welcome();
  scrollBottom();
  input.focus({ preventScroll: true });
})();
