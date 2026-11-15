#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ -f "${BACKEND_DIR}/.env" ]; then
  set -a
  . "${BACKEND_DIR}/.env"
  set +a
fi

ROOTFS_DIR="${AEGIS_ROOTFS_PATH:-/opt/aegis/rootfs}"
BIN_DIR="$(dirname "${AEGIS_BIN_PATH:-/opt/aegis/bin/aegis-run}")"
SHM_DIR="${AEGIS_SHM_DIR:-/dev/shm/aegis_jobs}"
CGROUP_ROOT="${AEGIS_CGROUP_ROOT:-/sys/fs/cgroup}"
ALPINE_VERSION="3.20.3"
ALPINE_ARCH="$(uname -m)"
if [ "${ALPINE_ARCH}" = "arm64" ]; then
  ALPINE_ARCH="aarch64"
fi
TARBALL="alpine-minirootfs-${ALPINE_VERSION}-${ALPINE_ARCH}.tar.gz"
URL="https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/${ALPINE_ARCH}/${TARBALL}"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

${SUDO} apt-get update
${SUDO} env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends build-essential libseccomp-dev curl ca-certificates

TMP_DIR="$(mktemp -d)"
if [ ! -f "${ROOTFS_DIR}/etc/alpine-release" ]; then
  curl -fsSL "${URL}" -o "${TMP_DIR}/${TARBALL}"
  ${SUDO} mkdir -p "${ROOTFS_DIR}"
  ${SUDO} tar -xzf "${TMP_DIR}/${TARBALL}" -C "${ROOTFS_DIR}"
fi
rm -rf "${TMP_DIR}"

if [ ! -x "${ROOTFS_DIR}/usr/bin/g++" ]; then
  ${SUDO} cp /etc/resolv.conf "${ROOTFS_DIR}/etc/resolv.conf"
  ${SUDO} chroot "${ROOTFS_DIR}" /sbin/apk add --no-cache g++ gcc musl-dev binutils python3 nodejs
fi

if [ ! -f "${CGROUP_ROOT}/cgroup.controllers" ]; then
  ${SUDO} mount -t cgroup2 none "${CGROUP_ROOT}" || true
fi

if [ -f "${CGROUP_ROOT}/cgroup.controllers" ]; then
  ${SUDO} sh -c "echo '+cpu +memory +pids' > ${CGROUP_ROOT}/cgroup.subtree_control" || true
fi

${SUDO} mkdir -p "${ROOTFS_DIR}/app" "${ROOTFS_DIR}/proc" "${ROOTFS_DIR}/tmp" "${ROOTFS_DIR}/old_root" "${ROOTFS_DIR}/dev" "${BIN_DIR}" "${SHM_DIR}"
${SUDO} chmod 1777 "${ROOTFS_DIR}/tmp"
${SUDO} chmod 1777 "${SHM_DIR}"

if [ ! -e "${ROOTFS_DIR}/dev/null" ]; then
  ${SUDO} mknod -m 666 "${ROOTFS_DIR}/dev/null" c 1 3 || true
fi
if [ ! -e "${ROOTFS_DIR}/dev/zero" ]; then
  ${SUDO} mknod -m 666 "${ROOTFS_DIR}/dev/zero" c 1 5 || true
fi
if [ ! -e "${ROOTFS_DIR}/dev/random" ]; then
  ${SUDO} mknod -m 666 "${ROOTFS_DIR}/dev/random" c 1 8 || true
fi
if [ ! -e "${ROOTFS_DIR}/dev/urandom" ]; then
  ${SUDO} mknod -m 666 "${ROOTFS_DIR}/dev/urandom" c 1 9 || true
fi

make -C "${BACKEND_DIR}/engine" clean
make -C "${BACKEND_DIR}/engine"
${SUDO} install -m 0755 "${BACKEND_DIR}/bin/aegis-run" "${BIN_DIR}/aegis-run"

echo "Aegis rootfs ready at ${ROOTFS_DIR}"
echo "Aegis engine installed at ${BIN_DIR}/aegis-run"
