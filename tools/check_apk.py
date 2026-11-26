#!/usr/bin/env python3
"""Проверяет готовый APK: внутри должны быть все веб-файлы и ровно 500 команд."""
import glob
import sys
import zipfile

NEED = ["assets/index.html", "assets/styles.css", "assets/app.js", "assets/commands.js"]


def main() -> None:
    pattern = sys.argv[1] if len(sys.argv) > 1 else "android/app/build/outputs/apk/release/*.apk"
    apks = glob.glob(pattern)
    if not apks:
        raise SystemExit(f"APK не найден по маске {pattern}")
    apk = apks[0]
    z = zipfile.ZipFile(apk)
    names = z.namelist()

    for n in NEED:
        if n not in names:
            raise SystemExit(f"в APK нет {n}")
    for n in ("AndroidManifest.xml", "classes.dex", "resources.arsc"):
        if n not in names:
            raise SystemExit(f"в APK нет {n}")

    catalog = z.read("assets/commands.js").decode("utf-8")
    if "globalThis.COMMANDS" not in catalog:
        raise SystemExit("в APK нет каталога команд")
    count = catalog.count('["')
    print(f"APK: {apk}")
    print(f"файлов внутри: {len(names)}, размер: {len(open(apk, 'rb').read())} байт")
    print("assets на месте:", ", ".join(NEED))
    print("команд в справочнике:", count)
    if count != 500:
        raise SystemExit(f"ожидалось 500 команд, а в APK {count}")


if __name__ == "__main__":
    main()
