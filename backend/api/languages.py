from dataclasses import dataclass


@dataclass(frozen=True)
class LanguageProfile:
    key: str
    label: str
    filename: str
    extension: str
    compile_command: tuple[str, ...] | None
    run_command: tuple[str, ...]
    artifact: str | None


LANGUAGE_PROFILES: dict[str, LanguageProfile] = {
    "cpp": LanguageProfile(
        key="cpp",
        label="C++20",
        filename="main.cpp",
        extension=".cpp",
        compile_command=("g++", "-O2", "-std=c++20", "{app}/main.cpp", "-o", "{app}/out"),
        run_command=("{app}/out",),
        artifact="{app}/out",
    ),
    "c": LanguageProfile(
        key="c",
        label="C11",
        filename="main.c",
        extension=".c",
        compile_command=("gcc", "-O2", "-std=c11", "{app}/main.c", "-o", "{app}/out"),
        run_command=("{app}/out",),
        artifact="{app}/out",
    ),
    "python": LanguageProfile(
        key="python",
        label="Python 3",
        filename="main.py",
        extension=".py",
        compile_command=None,
        run_command=("python3", "-I", "{app}/main.py"),
        artifact=None,
    ),
    "javascript": LanguageProfile(
        key="javascript",
        label="Node.js",
        filename="main.js",
        extension=".js",
        compile_command=None,
        run_command=("node", "{app}/main.js"),
        artifact=None,
    ),
}


def render_command(template: tuple[str, ...] | None, app_dir: str) -> list[str]:
    if template is None:
        return []
    return [part.replace("{app}", app_dir) for part in template]
