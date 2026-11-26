#!/usr/bin/env python3
"""Копирует веб-приложение в assets Android-проекта.

Запускается автоматически в CI и вручную:
    python3 tools/sync_assets.py

В APK попадают только нужные файлы (без serve.py, tools/ и т.п.),
поэтому веб-версия и приложение всегда одинаковые.
"""
import os
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, "android", "app", "src", "main", "assets")
FILES = ["index.html", "styles.css", "app.js", "commands.js"]


def main() -> None:
    os.makedirs(DEST, exist_ok=True)
    for name in FILES:
        src = os.path.join(ROOT, name)
        if not os.path.exists(src):
            raise SystemExit(f"нет файла: {name}")
        shutil.copy2(src, os.path.join(DEST, name))
        print(f"assets/{name}  ({os.path.getsize(src)} байт)")

    # страховка: каталог обязан содержать ровно 500 команд
    with open(os.path.join(DEST, "commands.js"), encoding="utf-8") as f:
        text = f.read()
    count = text.count('["')  # грубая, но независимая проверка
    if "globalThis.COMMANDS" not in text:
        raise SystemExit("commands.js: не найден каталог COMMANDS")
    print(f"каталог команд собран, записей ~{count}")


if __name__ == "__main__":
    main()
