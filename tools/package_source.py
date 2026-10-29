"""Create a source-only ZIP; dataset binaries and Git metadata are not included."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import shutil


def package_source(project):
    project = Path(project)
    output = project / "dist" / "Splat-Lab-Tile-Live-v9.zip"
    files = [
        "LICENSE", "serve.py", "prepare_pages.py", "configure_dataset.py", "configure_tiles.py", "frame_ply.py", "start-local.cmd",
        ".prettierrc.json", ".editorconfig", ".gitignore",
    ]
    files.extend(str(path.relative_to(project)) for path in (project / "dist").iterdir()
                 if path.is_file() and path.suffix.lower() != ".zip" and path.name != "qa-spark.html")
    for folder in ("tools", "tests"):
        files.extend(str(path.relative_to(project)) for path in (project / folder).rglob("*")
                     if path.is_file() and "__pycache__" not in path.parts)
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for name in sorted(set(files)):
            path = project / name
            if not path.is_file():
                raise FileNotFoundError(f'Missing required source file: {path}')
            archive.write(path, name)
    shutil.copy2(output, project / "dist" / "source.zip")
    return output


if __name__ == "__main__":
    print(package_source(Path(__file__).resolve().parents[1]))
