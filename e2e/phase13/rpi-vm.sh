#!/bin/bash
# 責務: Raspberry Pi相当の検証機（実物のRaspberry Pi OS Lite arm64のrootfs・ユーザーランドを、QEMUのarm64システムエミュレーションで起動）を、
#       Dockerだけで（root権限・KVM・qemuのホストへの導入なしで）作って操作する。インストーラ（Phase 13）のarm64・Raspberry Pi OSでの検証用。
# 使い方: bash e2e/phase13/rpi-vm.sh <prepare|start|wait|ssh|stop|destroy> [ssh時はコマンド...]
#   prepare  イメージの取得（SHA256検証）・展開・ディスクの拡張・検証用ユーザーとSSH鍵の書き込み・qemuイメージのビルド・
#            段階1のカーネルの取り出し
#   start    VM起動（バックグラウンド。SSH: 127.0.0.1:$RPI_SSH_PORT、Web UI: 127.0.0.1:$RPI_WEB_PORT）。段階2のカーネルがあればそれを使う
#   kernel   段階1で起動したVMの中にDebianの汎用カーネルを導入し、カーネル・initrdを取り出して、VMを段階2（そのカーネル）で再起動する
#   wait     SSHでログインできるまで待つ（最大約20分。エミュレーションのため起動は遅い）
#   ssh      VMへSSH（例: bash e2e/phase13/rpi-vm.sh ssh sudo sh -c 'uname -a'）
#   stop     VMを停止（ディスクは残る）  destroy: VMとディスクを削除
# 環境変数: RPI_VM_DIR（作業ディレクトリ。既定 ~/.cache/vpngwgui-rpi-vm）、RPI_VM_MEM（既定6G）、RPI_VM_CPUS（既定4）、
#           RPI_VM_DISK（既定32G）、RPI_SSH_PORT（既定2222）、RPI_WEB_PORT（既定18081）、RPI_IMAGE_URL（Pi OSのimg.xzのURL）
# カーネルについて: Raspberry Pi用のカーネルはvirtio・PCIホストを組み込んでおらず、QEMUのvirtマシンでは起動できない（qemuのraspi4bはNICが無い）。
#       そのため、rootfs・ユーザーランド（NetworkManager・cloud-init・aptの構成・os-release）は実物のRaspberry Pi OSで、カーネルだけDebianのarm64カーネルに替える。
# 注意: KVMが無いためTCG（ソフトウェアエミュレーション）。実機の10〜30倍遅く、Dockerイメージのビルドは特に遅い。
#       Raspberry Piのカーネル・ユーザーランド（NetworkManager・cloud-init・apt構成）は実物だが、SoC固有のもの（GPIO・Wi-Fi等）は無い。

set -eu
DIR=${RPI_VM_DIR:-$HOME/.cache/vpngwgui-rpi-vm}
MEM=${RPI_VM_MEM:-6G}
CPUS=${RPI_VM_CPUS:-4}
DISK=${RPI_VM_DISK:-32G}
SSH_PORT=${RPI_SSH_PORT:-2222}
WEB_PORT=${RPI_WEB_PORT:-18081}
DEBIAN_CLOUD_URL=${RPI_DEBIAN_CLOUD_URL:-https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-arm64.qcow2}
IMAGE_URL=${RPI_IMAGE_URL:-https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2026-09-15/2026-09-15-raspios-trixie-arm64-lite.img.xz}
QEMU_IMAGE=vpngwgui-qemu-aarch64
NAME=vpngwgui-rpi-vm
SSH_KEY=${RPI_SSH_KEY:-$DIR/id_ed25519}
SSH_OPTS="-o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10 -i $SSH_KEY -p $SSH_PORT"

log() { printf '==> %s\n' "$*"; }
die() { printf 'エラー: %s\n' "$*" 1>&2; exit 1; }

# 目的: 作業用の補助コンテナ（fdisk・mtools）でコマンドを実行する。 入力: 実行するシェル文字列（作業ディレクトリは$DIR）。
tools() {
  # 補助コンテナはrootで動くため、作られたファイルの所有者を呼び出したユーザーへ戻す。
  docker run --rm -v "$DIR:/w" -w /w debian:trixie-slim sh -c "apt-get update -qq >/dev/null && apt-get install -y -qq fdisk mtools >/dev/null 2>&1; $1; chown -R $(id -u):$(id -g) /w"
}

prepare() {
  mkdir -p "$DIR/boot"
  if [ ! -f "$DIR/pios.img" ]; then
    log "Raspberry Pi OSのイメージを取得"
    curl -fsSL -o "$DIR/pios.img.xz" "$IMAGE_URL"
    curl -fsSL -o "$DIR/pios.sha256" "$IMAGE_URL.sha256"
    (cd "$DIR" && sed 's/  .*/  pios.img.xz/' pios.sha256 | sha256sum -c -) || die "SHA256が一致しません"
    xz -dk "$DIR/pios.img.xz"
    mv "$DIR/pios.img.xz" "$DIR/pios.img.xz.keep" 2>/dev/null || true
    mv "$DIR/pios.img.xz.keep" "$DIR/pios.img.xz"
  fi
  [ -f "$DIR/pios.img.expanded" ] || { truncate -s "$DISK" "$DIR/pios.img" && : > "$DIR/pios.img.expanded"; }
  log "検証用ユーザー（vpngw）・SSH鍵をrootfsへ書き込む（Pi OSには既定のpiユーザー（uid 1000。SSHは初回設定まで拒否される）があるため、別名・別uidにする）"
  # 検証専用のSSH鍵（VMへのログイン用。作業ディレクトリに作る。既存の鍵は使わない）。
  [ -f "$SSH_KEY" ] || ssh-keygen -q -t ed25519 -N "" -f "$SSH_KEY"
  if [ ! -f "$DIR/pios.img.patched" ]; then
    # 段階1のカーネル（Debianのクラウドカーネル）は、rootfsに対応するmodulesが無くvfatを読めない。cloud-init（設定をvfatのbootから読む）に
    # 頼らず、ext4のrootfsへ直接、検証用ユーザー（vpngw。鍵ログインのみ・sudo NOPASSWD）を作り、cloud-initを無効化し、
    # fstabのboot領域（vfat）はnofailにして起動を止めないようにする。
    cp "$SSH_KEY.pub" "$DIR/boot/authorized_keys"
    printf 'vpngw ALL=(ALL) NOPASSWD:ALL\n' > "$DIR/boot/sudoers-vpngw"
    tools 'apt-get install -y -qq e2fsprogs >/dev/null 2>&1
      ROOTSTART=$(sfdisk -d pios.img | awk "/pios.img2/ {gsub(\",\",\"\",\$4); print \$4}"); IMG="pios.img?offset=$((512*ROOTSTART))"
      dw() { debugfs -w -R "$1" "$IMG" >/dev/null 2>&1; }
      # 目的: ゲストのファイルへ行を追加して書き戻す（元の所有者・モードを保つ）。 入力: パス, 追加する行, モード, gid
      addline() { debugfs -R "cat $1" "$IMG" 2>/dev/null > boot/tmp.file; printf "%s\n" "$2" >> boot/tmp.file; dw "rm $1"; dw "write boot/tmp.file $1"; dw "sif $1 mode $3"; dw "sif $1 gid $4"; }
      addline /etc/passwd "vpngw:x:1001:1001:verify user:/home/vpngw:/bin/bash" 0100644 0
      addline /etc/shadow "vpngw:*:19000:0:99999:7:::" 0100640 42
      addline /etc/group "vpngw:x:1001:"  0100644 0
      debugfs -R "cat /etc/group" "$IMG" 2>/dev/null | sed "s/^\(sudo:x:[0-9]*:.*\)\$/\1,vpngw/; s/^\(sudo:x:[0-9]*:\),vpngw\$/\1vpngw/" > boot/group.new; dw "rm /etc/group"; dw "write boot/group.new /etc/group"; dw "sif /etc/group mode 0100644"
      dw "mkdir /home/vpngw"; dw "mkdir /home/vpngw/.ssh"; dw "write boot/authorized_keys /home/vpngw/.ssh/authorized_keys"
      for f in /home/vpngw /home/vpngw/.ssh /home/vpngw/.ssh/authorized_keys; do dw "sif $f uid 1001"; dw "sif $f gid 1001"; done
      dw "sif /home/vpngw mode 040755"; dw "sif /home/vpngw/.ssh mode 040700"; dw "sif /home/vpngw/.ssh/authorized_keys mode 0100600"
      dw "write boot/sudoers-vpngw /etc/sudoers.d/vpngw"; dw "sif /etc/sudoers.d/vpngw mode 0100440"
      dw "write /dev/null /etc/cloud/cloud-init.disabled"
      debugfs -R "cat /etc/fstab" "$IMG" 2>/dev/null | sed "s#\(/boot/firmware *vfat *defaults\)#\1,nofail#" > boot/fstab.new
      dw "rm /etc/fstab"; dw "write boot/fstab.new /etc/fstab"; dw "sif /etc/fstab mode 0100644"
      echo "--- 確認"; debugfs -R "cat /etc/passwd" "$IMG" 2>/dev/null | tail -2; debugfs -R "cat /etc/group" "$IMG" 2>/dev/null | grep "^sudo"; debugfs -R "ls -l /home/vpngw/.ssh" "$IMG" 2>/dev/null | head -4; debugfs -R "cat /etc/fstab" "$IMG" 2>/dev/null | grep firmware
      debugfs -R "ls /etc/cloud" "$IMG" 2>/dev/null | grep -q cloud-init.disabled && debugfs -R "cat /home/vpngw/.ssh/authorized_keys" "$IMG" 2>/dev/null | grep -q ssh-ed25519 || { echo "ユーザーの書き込みに失敗" >&2; exit 1; }' && : > "$DIR/pios.img.patched"
  fi
  if ! docker image inspect "$QEMU_IMAGE" >/dev/null 2>&1; then
    log "qemuのDockerイメージをビルド"
    docker build -q -t "$QEMU_IMAGE" - <<'EODF'
FROM debian:trixie-slim
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends qemu-system-arm qemu-utils && rm -rf /var/lib/apt/lists/*
EODF
  fi
  if [ ! -f "$DIR/boot/stage1-vmlinuz" ]; then
    log "段階1のカーネル・initrd（Debianのクラウドイメージ）を取り出す"
    curl -fsSL -o "$DIR/debian.qcow2" "$DEBIAN_CLOUD_URL"
    docker run --rm -v "$DIR:/w" -w /w "$QEMU_IMAGE" qemu-img convert -O raw debian.qcow2 debian.raw
    tools 'apt-get install -y -qq e2fsprogs >/dev/null 2>&1
      START=$(sfdisk -d debian.raw | awk "/start=/ {gsub(\",\",\"\",\$4); gsub(\",\",\"\",\$6); if (\$6+0>m) {m=\$6+0; s=\$4}} END {print s}"); echo root-start=$START
      IMG="debian.raw?offset=$((512*START))"
      K=$(debugfs -R "ls /boot" "$IMG" 2>/dev/null | tr " " "\n" | grep "^vmlinuz-" | head -1); R=$(debugfs -R "ls /boot" "$IMG" 2>/dev/null | tr " " "\n" | grep "^initrd.img-" | head -1); echo K=$K R=$R
      debugfs -R "dump /boot/$K boot/stage1-vmlinuz" "$IMG"; debugfs -R "dump /boot/$R boot/stage1-initrd" "$IMG"'
    rm -f "$DIR/debian.raw" "$DIR/debian.qcow2"
  fi
  log "準備完了: $DIR"
}

start() {
  # 段階2（ゲストに導入した汎用カーネル）があればそれ、無ければ段階1（Debianのクラウドカーネル）。
  KERNEL=stage1-vmlinuz; INITRD=stage1-initrd
  [ -f "$DIR/boot/stage2-vmlinuz" ] && { KERNEL=stage2-vmlinuz; INITRD=stage2-initrd; }
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  log "VMを起動（カーネル: $KERNEL。TCG。起動には数分かかる）。シリアルログ: $DIR/serial.log"
  docker run -d --name "$NAME" --network host -v "$DIR:/w" -w /w "$QEMU_IMAGE" \
    qemu-system-aarch64 -M virt -cpu cortex-a72 -smp "$CPUS" -m "$MEM" -accel tcg,thread=multi -nographic \
    -kernel "boot/$KERNEL" -initrd "boot/$INITRD" \
    -append "console=ttyAMA0 root=/dev/vda2 rootfstype=ext4 rw rootwait fsck.repair=yes net.ifnames=0" \
    -drive file=pios.img,if=virtio,format=raw,cache=writeback \
    -netdev "user,id=n0,hostfwd=tcp:127.0.0.1:$SSH_PORT-:22,hostfwd=tcp:127.0.0.1:$WEB_PORT-:8080" -device virtio-net-pci,netdev=n0,romfile= \
    -serial file:/w/serial.log >/dev/null
}

wait_ssh() {
  log "SSHの応答を待機（最大約20分）"
  for _ in $(seq 1 120); do
    # shellcheck disable=SC2086
    if ssh $SSH_OPTS vpngw@127.0.0.1 true >/dev/null 2>&1; then log "SSH接続できました"; return 0; fi
    sleep 10
  done
  tail -30 "$DIR/serial.log" 1>&2
  die "SSHに接続できません"
}

# 目的: 段階1のVMへDebianの汎用カーネルを導入し、カーネル・initrdを取り出して段階2で再起動する。
# 副作用: ゲストのinitramfs設定をMODULES=mostへ変更する（virtioのモジュールをinitrdへ含めるため）。
kernel() {
  log "ゲストへDebianの汎用カーネルを導入（modulesも入る）"
  # shellcheck disable=SC2086
  ssh $SSH_OPTS vpngw@127.0.0.1 'sudo sh -c "sed -i s/^MODULES=.*/MODULES=most/ /etc/initramfs-tools/initramfs.conf; export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq linux-image-arm64 >/dev/null; ls /boot"'
  # shellcheck disable=SC2086
  V=$(ssh $SSH_OPTS vpngw@127.0.0.1 'ls /boot | grep "^vmlinuz-.*arm64$" | sort -V | tail -1 | sed s/^vmlinuz-//')
  [ -n "$V" ] || die "導入したカーネルが見つかりません"
  log "カーネル $V を取り出す"
  # shellcheck disable=SC2086
  ssh $SSH_OPTS vpngw@127.0.0.1 "sudo cat /boot/vmlinuz-$V" > "$DIR/boot/stage2-vmlinuz"
  # shellcheck disable=SC2086
  ssh $SSH_OPTS vpngw@127.0.0.1 "sudo cat /boot/initrd.img-$V" > "$DIR/boot/stage2-initrd"
  # shellcheck disable=SC2086
  ssh $SSH_OPTS vpngw@127.0.0.1 'sudo poweroff' || true
  sleep 15
  docker stop "$NAME" >/dev/null 2>&1 || true
  start
  wait_ssh
}

case "${1:-}" in
  prepare) prepare ;;
  start) start ;;
  kernel) kernel ;;
  wait) wait_ssh ;;
  ssh) shift; ssh $SSH_OPTS vpngw@127.0.0.1 "$@" ;;
  stop)
    # ディスクへの書き込みを失わないよう、まずゲストを正常にシャットダウンする。
    # shellcheck disable=SC2086
    ssh $SSH_OPTS vpngw@127.0.0.1 'sudo poweroff' >/dev/null 2>&1 || true
    for _ in $(seq 1 30); do docker ps -q -f "name=$NAME" | grep -q . || break; sleep 2; done
    docker stop "$NAME" >/dev/null 2>&1 || true; docker rm "$NAME" >/dev/null 2>&1 || true ;;
  destroy) docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$DIR" ;;
  *) sed -n '2,16p' "$0"; exit 1 ;;
esac
