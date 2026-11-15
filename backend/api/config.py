from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ENV_FILE), env_file_encoding="utf-8", extra="ignore")

    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    AEGIS_API_KEY: str = "aegis_secret_dev_key_2026"
    ALLOWED_ORIGINS: str = "http://localhost:5173"
    AEGIS_BIN_PATH: str = "/opt/aegis/bin/aegis-run"
    AEGIS_ROOTFS_PATH: str = "/opt/aegis/rootfs"
    AEGIS_SHM_DIR: str = "/dev/shm/aegis_jobs"
    AEGIS_CGROUP_ROOT: str = "/sys/fs/cgroup"
    MAX_CONCURRENT_SANDBOXES: int = 4

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
