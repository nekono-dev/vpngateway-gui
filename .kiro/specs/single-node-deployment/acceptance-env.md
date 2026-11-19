# 実機受入環境（LXD コンテナ）

タスク 7.1 の受入手順。7.3〜7.6 は検証サーバ `192.168.3.240` 上に既設の LXD system container `acc-vpngwgui` の中で行う。判断日・ラボ確認日は 2026-11-19。受入記録は [.kiro/specs/single-node-deployment/acceptance-results.md](./acceptance-results.md) にタスクごとに追記する。

## 1. 接続と権限

接続先は `ubuntu@192.168.3.240`。接続認証情報は既存の利用者側 SSH 設定から取得し、この文書、コマンド引数、結果記録へ書かない。以降は開発ホスト上で次を定義して `$SSH` / `$SCP` を使う。

```sh
SSH='ssh -o ConnectTimeout=10 ubuntu@192.168.3.240'
SCP='scp -o ConnectTimeout=10'
```

`lxc` は検証サーバの `ubuntu` で使える。開発ホスト上では実行しない。コンテナ内のコマンドは `lxc exec acc-vpngwgui -- sh -c '...'` で root として動く。コンテナ内に `sudo` を導入してあり、root の sudo 呼び出しも使える（topology.sh / provision.sh が sudo を呼ぶため）。

## 2. ラボの理由・環境・適用範囲

実機受入 7.3〜7.6 は、共有サーバ本体ではなく既設コンテナ内で実施する。サーバには単一の物理 NIC があり、VPN forward の hosted mock は既定経路を VPN veth に変更する。ホスト上で行うと SSH が切れる一方、LXD system container では変更がコンテナの network namespace 内に限られる。`e2e/hosted/lib/topology.sh` の `e2eseg` bridge、`lan` / `isp` / `vpnexit` namespace、VPN tunnel veth と mock stack で、VPN forward を含むすべての経路を試験できる。サーバへの SSH は影響を受けない。

LXD コンテナはサーバと kernel を共有する。nftables、network namespace、sysctl の操作はコンテナ側の network namespace に作用し、独立 kernel の検証ではない。kernel-level の結果はサーバ kernel `6.8.0-149` に依存する。systemd の boot guard 起動順序はコンテナ内 systemd で検証する。「host reboot」要求の結果はコンテナ再起動 `lxc restart acc-vpngwgui` として扱い、物理サーバは再起動しない。

確認済みのラボ facts（2026-11-19）:

- サーバ: LXD 5.21.9 LTS。Ubuntu 24.04 LTS release `20261017` のローカル image store から作成。storage pool `default` は `dir` driver。
- container: Ubuntu 24.04.5、systemd running、`eth0` は `lxdbr0` 上の `10.67.164.0/24`、default route `10.67.164.1`、NAT internet access。
- 内部で Docker 29.1.3 / Compose 2.40.3 が rootful で動作し、`docker run alpine:3.21` 成功。nftables 1.0.9、`ip netns add/del`、`sysctl -w net.ipv4.ip_forward=1` も成功。
- `curl`, `ca-certificates`, `openssl`, `jq`, `tar`, `iproute2`, `nftables`, `shellcheck` が導入済み。UID/GID 10001 は空き。
- `default` は `dir` pool でブロック共有されず、作成時点のサーバ空き容量は約 41 GB。nested Docker build は数 GB を使うため、作業ごとに容量を確認し、ラボは終了後に必ず削除する。

サーバの旧方式スタックと旧 systemd unit・host 設定はサーバ上に残り、稼働中である。受入対象は別の container namespace / Docker daemon / filesystem のため、それらは未変更のままでよく、サーバ上の旧スタックには一切触れない。

## 3. ラボのライフサイクル

既設 container を使う前に状態と容量を確認する。

```sh
$SSH 'lxc info acc-vpngwgui; lxc exec acc-vpngwgui -- df -h /'
```

再作成が必要なときだけ、下記の exact launch command を実行する。既に存在する container を重ねて launch しない。

```sh
$SSH 'lxc launch 12a0de07e168 acc-vpngwgui -c security.nesting=true -c security.syscalls.intercept.mknod=true -c security.syscalls.intercept.setxattr=true'
$SSH 'lxc exec acc-vpngwgui -- sh -c "until getent hosts archive.ubuntu.com >/dev/null 2>&1; do sleep 2; done"'
$SSH 'lxc exec acc-vpngwgui -- sh -c "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 curl ca-certificates openssl jq tar iproute2 nftables shellcheck sudo xz-utils dnsutils"'
$SSH 'lxc exec acc-vpngwgui -- sh -c "systemctl enable --now docker && docker run --rm alpine:3.21 true && nft add table inet acc_probe && nft delete table inet acc_probe && ip netns add acc-probe && ip netns del acc-probe && sysctl -w net.ipv4.ip_forward=1"'
```

mock service helper (`npx tsx`) には Node.js 22 以上と npm が必要である。コンテナ内で `node --version` と `npm --version` を確認する。Node.js 22 以上が無い場合は、コンテナの root shell で次を実行して Node 22 の最新配布版を checksum 検証して導入する（対応 architecture は x86_64 / aarch64）。製品 runner の image build も Dockerfile 内で Node 22 を使う。

```sh
$SSH 'lxc exec acc-vpngwgui -- sh -s' <<'NODE22'
set -eu
case "$(uname -m)" in x86_64) NODE_ARCH=x64 ;; aarch64) NODE_ARCH=arm64 ;; *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;; esac
NODE_VERSION=$(curl -fsSL https://nodejs.org/dist/index.json | jq -r '[.[] | select(.version | startswith("v22."))][0].version')
NODE_FILE="node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/${NODE_FILE}" -o "/tmp/${NODE_FILE}"
curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt" -o /tmp/node22-SHASUMS256.txt
(cd /tmp && grep " ${NODE_FILE}$" node22-SHASUMS256.txt | sha256sum -c -)
tar -xJf "/tmp/${NODE_FILE}" -C /usr/local --strip-components=1
unlink "/tmp/${NODE_FILE}"
unlink /tmp/node22-SHASUMS256.txt
node --version
npm --version
NODE22
```

Node.js が既に 22+ の場合は Node installation block を省略する。version 確認後、いずれの場合も clean baseline を保存する。

```sh
$SSH 'lxc snapshot acc-vpngwgui clean'
```

受入の間は clean snapshot を復元して各 run を独立させる。running container は先に stop し、既存名を維持したまま restore する。

```sh
$SSH 'lxc stop acc-vpngwgui --force || true; lxc restore acc-vpngwgui clean; lxc start acc-vpngwgui'
```

容量を受入開始前・mock image build 後・終了前に確認する。container とサーバ双方で十分な空きを確かめる。

```sh
$SSH 'df -h /; lxc storage info default; lxc exec acc-vpngwgui -- df -h /'
```

すべての container 内 Compose project を停止し、ラボ専用ファイルが必要なら保存した後、受入終了時に削除する。`dir` pool は server と block を共有しないため、放置しない。

```sh
$SSH 'lxc stop acc-vpngwgui --force || true; lxc delete -f acc-vpngwgui; df -h /; lxc storage info default'
```

## 4. 受入 bundle と mock 資材

### 4.1 製品 bundle（開発ホストで作成）

既存の bundle build / checksum / layout 確認手順を使う。`build-compose-bundle.sh` は version と tar.gz 出力先の2引数を受け取り、checksum は別途作る。`tar -tzf` の先頭は `vpngwgui-<VERSION>/` である。

```sh
VERSION='<受入する版>'
OUT="dist/vpngwgui-$VERSION.tar.gz"
mkdir -p dist
sh scripts/build-compose-bundle.sh "$VERSION" "$OUT"
(cd dist && sha256sum "vpngwgui-$VERSION.tar.gz" > "vpngwgui-$VERSION.tar.gz.sha256")
(cd dist && sha256sum -c "vpngwgui-$VERSION.tar.gz.sha256")
$SSH 'mkdir -p ~/acceptance'
$SCP "dist/vpngwgui-$VERSION.tar.gz" "dist/vpngwgui-$VERSION.tar.gz.sha256" ubuntu@192.168.3.240:~/acceptance/
```

サーバでは受信 checksum を確認し、bundle tarball と checksum file を container に push する。展開先は container 内 `/root/vpngwgui` とし、container 内で checksum を再確認してから展開する。

```sh
$SSH "cd ~/acceptance && sha256sum -c vpngwgui-$VERSION.tar.gz.sha256"
$SSH "lxc file push ~/acceptance/vpngwgui-$VERSION.tar.gz acc-vpngwgui/root/vpngwgui-$VERSION.tar.gz"
$SSH "lxc file push ~/acceptance/vpngwgui-$VERSION.tar.gz.sha256 acc-vpngwgui/root/vpngwgui-$VERSION.tar.gz.sha256"
$SSH "lxc exec acc-vpngwgui -- sh -c 'mkdir -p /root/vpngwgui && cd /root && sha256sum -c vpngwgui-$VERSION.tar.gz.sha256 && tar -xzf vpngwgui-$VERSION.tar.gz -C /root/vpngwgui --strip-components=1 && test -f /root/vpngwgui/compose/host-preparation.sh'"
$SSH 'lxc exec acc-vpngwgui -- sh -c "cd /root/vpngwgui && docker compose -p vpngwgui config --quiet"'
```

### 4.2 hosted mock 資材（別 tarball）

Compose bundle に `e2e/` と `docker-compose.e2e-mock.yml` は含まれない（`scripts/bundle-manifest.txt` で確認）。mock runner の Dockerfile は build context 内の `package.json` / lockfile、`proxy/`、`tsconfig.base.json`、`e2e/hosted/vendors/mock-cli/` を読む。topology / provision helper と ISP mock service も別途配置する。次の tracked file list は `git ls-files` で作成し、受入 helper が参照するファイルを含める。

- `e2e/hosted/lib/*.sh`（`env.sh`, `topology.sh`, `provision.sh`, `cleanup.sh`, `certs.sh`, `tls-matrix-certs.sh` など）
- `e2e/hosted/fixtures/compose-cli.ts`, `e2e/hosted/fixtures/compose.ts`
- `e2e/hosted/vendors/protonvpn/{compose.yml,Dockerfile}`、`e2e/hosted/vendors/adguardvpn/{compose.yml,Dockerfile}`
- `e2e/hosted/vendors/mock-cli/{main.ts,mockvpn.ts,network.ts}`
- `e2e/hosted/services/{isp-main.ts,isp-https.ts,isp-dns.ts,zone.ts,dns-query.ts}`
- root `docker-compose.e2e-mock.yml`

別 tarball を作成し checksum を添えてサーバへ送り、container 内 `/root/vpngwgui` に重ねて配置する。`git ls-files` は repository の tracked file だけを列挙し、未追跡の鍵・作業ファイルを含めない。

```sh
MOCK_TAR="/tmp/vpngwgui-mock-inputs.tar.gz"
MOCK_SUM="$MOCK_TAR.sha256"
git ls-files -z -- 'e2e/hosted/lib/*.sh' e2e/hosted/fixtures/compose-cli.ts e2e/hosted/fixtures/compose.ts e2e/hosted/vendors/protonvpn/compose.yml e2e/hosted/vendors/protonvpn/Dockerfile e2e/hosted/vendors/adguardvpn/compose.yml e2e/hosted/vendors/adguardvpn/Dockerfile e2e/hosted/vendors/mock-cli/main.ts e2e/hosted/vendors/mock-cli/mockvpn.ts e2e/hosted/vendors/mock-cli/network.ts e2e/hosted/services/isp-main.ts e2e/hosted/services/isp-https.ts e2e/hosted/services/isp-dns.ts e2e/hosted/services/zone.ts e2e/hosted/services/dns-query.ts docker-compose.e2e-mock.yml | tar --null --files-from=- -czf "$MOCK_TAR"
(cd /tmp && sha256sum vpngwgui-mock-inputs.tar.gz > vpngwgui-mock-inputs.tar.gz.sha256)
(cd /tmp && sha256sum -c vpngwgui-mock-inputs.tar.gz.sha256)
$SCP "$MOCK_TAR" "$MOCK_SUM" ubuntu@192.168.3.240:~/acceptance/
$SSH 'cd ~/acceptance && sha256sum -c vpngwgui-mock-inputs.tar.gz.sha256 && lxc exec acc-vpngwgui -- mkdir -p /root/vpngwgui'
$SSH 'lxc file push /home/ubuntu/acceptance/vpngwgui-mock-inputs.tar.gz acc-vpngwgui/root/vpngwgui-mock-inputs.tar.gz'
$SSH 'lxc exec acc-vpngwgui -- sh -c "cd /root/vpngwgui && tar -xzf /root/vpngwgui-mock-inputs.tar.gz -C /root/vpngwgui && rm /root/vpngwgui-mock-inputs.tar.gz"'
```

サーバ転送元で `/home/ubuntu/acceptance/` を使う例はサーバの ubuntu home に対応する。SSH 側で環境変数を使う場合は実際のファイル名へ合わせる。bundle 版番号と mock tarball を同じ結果記録に記す。

`topology.sh` と `provision.sh` は `sudo` を呼ぶため、sudo package を含むラボを使う。root shell から helper を呼ぶ。`topology_up` は container の default route を切り替える。container の network namespace だけに作用し、サーバ SSH route は変わらない。host 側で `topology.sh` を実行しない。

## 5. コンテナ内の製品設定と初期状態検査

受入用 `.env` は container 内 `/root/vpngwgui/.env` にだけ作る。基底 Compose の順序は root → protonvpn → adguardvpn → mock override。`COMPOSE_FILE` に指定するときもこの順番を保つ。Hosted provision helper は同じ固定 fragment 群を使う。VPN provider credentials は入力しない。

```sh
$SSH 'lxc exec acc-vpngwgui -- sh -c "cd /root/vpngwgui && printf \"%s\\n\" WEB_HTTPS_ENABLED=false WEB_PORT=18080 GATEWAY_TLS_ENABLED=false VPN_PROVIDERS=protonvpn,adguardvpn LAN_IFACE=e2eseg DNS_RELAY_PORT=5353 COMPOSE_FILE=docker-compose.yml:vendors/protonvpn/compose.yml:vendors/adguardvpn/compose.yml:docker-compose.e2e-mock.yml > .env"'
```

`LAN_IFACE=e2eseg` は hosted topology bridge に合わせる。container の systemd-resolved stub は `127.0.0.53:53` を使うため、受入 DNS relay は `DNS_RELAY_PORT=5353` とする。開始前に `ss -lunpt` と `ss -ltnp` で確認し、port 53 を使う別 service を止めない。`WEB_PORT=18080` は container 内で空き確認する。

下の read-only checker は新方式の host-preparation が不在/再利用可能な clean baseline か、同一名の旧方式資材や port/project conflict がないかを見る。全て container 内で実行し、`NG` があれば調査する。旧サーバ側の状態に対しては実行しない。checker は read-only（Docker/nft/systemd list、file stat のみ）で、どの path も削除しない。

### host-preparation の競合・残留パス

以下は `compose/host-preparation/` の handler が作成・検査・移動する固定パスと一時名パターンである。`<PID>` は handler の shell PID、`<N>` は試行番号、`<hex>` は proxy が生成する16進文字列を表す。適用中の固定資材は clean baseline では存在しない。state directory と reboot spool は apply 中に作成され、clean baseline では不在である。受入 run の途中での確認では、handler が正常に適用した固定資材を状態に応じて読み替える。

| 種別 | 固定パス / パターン | 用途・扱い |
|---|---|---|
| state | `/var/lib/vpngwgui-host-preparation/`、`state.json` | state directory と所有記録。受入開始前は不在または空の安全な directory。|
| state temp | `/var/lib/vpngwgui-host-preparation/.state.json.<PID>.<N>`、`.state-sysctl.<PID>.tmp`、`.state-boot-guard.<PID>.<N>`、`.state-host-reboot.<PID>.tmp`、`.state-host-reboot-remove.<PID>.tmp` | state 初期化・sysctl・boot guard・reboot handler の state 更新用。残留は NG。|
| sysctl | `/etc/sysctl.d/99-vpngwgui-host-preparation.conf`、`/etc/sysctl.d/.vpngwgui-sysctl.<PID>.tmp` | 固定設定と install 用 hard-link 元一時ファイル。|
| boot guard fixed | `/etc/systemd/system/vpngwgui-boot-guard.service`、`/etc/systemd/system/docker.service.requires/vpngwgui-boot-guard.service`、`/etc/vpngwgui/boot-guard.nft`、`/etc/vpngwgui/` | unit、Docker dependency symlink、rules file と親 directory。apply 中は所有記録・status に照らす。|
| boot guard temp | `/etc/systemd/system/.vpngwgui-boot-guard-expected.<PID>.tmp`、`/etc/systemd/system/.vpngwgui-boot-guard.<PID>.tmp`、`/etc/vpngwgui/.vpngwgui-boot-guard-update.<PID>.tmp`、state directory 内の `.boot-guard-rules-old.<PID>.tmp`、`.boot-guard-rules-current.<PID>.tmp`、`.boot-guard-rules-target.<PID>.tmp`、`.boot-guard-rules-previous.<PID>.tmp`、`.boot-guard-remove-unit.<PID>.tmp`、`.boot-guard-remove-rules.<PID>.tmp`、`.boot-guard-remove-previous-rules.<PID>.tmp`、`.boot-guard-preflight.<PID>.tmp`、`.boot-guard-block.<PID>.nft` | unit/rules の install・更新・比較・remove preflight・初期 BLOCK 用。残留は NG。|
| reboot fixed | `/var/lib/vpngwgui-host-ctl/`、`/usr/local/libexec/vpngwgui-host-reboot`、`/etc/systemd/system/vpngwgui-host-reboot.path`、`/etc/systemd/system/vpngwgui-host-reboot.service`、`/etc/systemd/system/multi-user.target.wants/vpngwgui-host-reboot.path`、`/var/lib/vpngwgui-host-reboot-spool/`、spool 内の `rejected/` | host-control directory、helper、path/service unit、enable symlink、spool と拒否要求用 directory。|
| reboot temp | `/usr/local/libexec/.vpngwgui-host-reboot-expected.<PID>.tmp`、`/usr/local/libexec/.vpngwgui-host-reboot.<PID>.tmp`、`/etc/systemd/system/.vpngwgui-host-reboot.<PID>.tmp`、`/var/lib/vpngwgui-host-preparation/.host-reboot-check.<PID>.tmp`、`/var/lib/vpngwgui-host-preparation/.boot-guard-block.<PID>.nft` | helper/unit の比較・install、一時 check、reboot handler の BLOCK 用。残留は NG。|
| reboot request | `/var/lib/vpngwgui-host-ctl/reboot-request`、`/var/lib/vpngwgui-host-ctl/.reboot-request.tmp.<digits>.<hex>` | 固定 request と proxy が排他的作成する hidden temporary request。後者は host-preparation の cleanable-name check にも使われる。|
| reboot spool entry | `/var/lib/vpngwgui-host-reboot-spool/request.<PID>.<N>`、`/var/lib/vpngwgui-host-reboot-spool/rejected/request.<PID>-<N>` | 消費済み要求と拒否要求。spool directory 内のその他 entry もすべて検査対象。|

一時ファイル、request、spool entry または予期しない directory が見つかったら、次の run の前に handler の状態と照合して調査する。削除する場合は、まず root 所有など期待する所有者・mode、通常ファイル（symlink でないこと）、内容が当該 handler の一時生成物であることを確認し、確認できた対象だけを削除する。spool / rejected の entry は同じく所有者・symlink・内容を確認してから扱う。見覚えのないものや確認できないものは残して調査する。fresh lab container ではこれらの残留物は期待しないが、apply/remove の中断や `lxc stop` による run 中断後には残ることがある。clean snapshot `clean` の復元が最も簡単な cleanup である。

```sh
$SSH 'lxc exec acc-vpngwgui -- sh -s' <<'CHECKER'
set -u
check_absent() {
  label=$1; path=$2
  if [ -e "$path" ] || [ -L "$path" ]; then printf 'NG %s: exists (%s)\n' "$label" "$path"; else printf 'OK %s: absent\n' "$label"; fi
}
check_table_absent() {
  label=$1; family=$2; table=$3
  if nft list table "$family" "$table" >/dev/null 2>&1; then printf 'NG %s: table exists (%s %s)\n' "$label" "$family" "$table"; else printf 'OK %s: absent\n' "$label"; fi
}
check_unit_absent() {
  label=$1; unit=$2; path=$3
  if [ -e "$path" ] || [ -L "$path" ] || systemctl is-active --quiet "$unit" || systemctl is-enabled --quiet "$unit"; then printf 'NG %s: unit/file exists or enabled (%s)\n' "$label" "$unit"; else printf 'OK %s: absent/disabled\n' "$label"; fi
}
if [ ! -e /var/lib/vpngwgui-host-preparation ] && [ ! -L /var/lib/vpngwgui-host-preparation ]; then
  echo 'OK current state directory: absent'
elif [ -d /var/lib/vpngwgui-host-preparation ] && [ ! -L /var/lib/vpngwgui-host-preparation ] &&
  [ "$(stat -c '%u:%g %a' /var/lib/vpngwgui-host-preparation 2>/dev/null)" = '0:0 700' ] &&
  [ ! -e /var/lib/vpngwgui-host-preparation/state.json ] && [ ! -L /var/lib/vpngwgui-host-preparation/state.json ] &&
  [ -z "$(find /var/lib/vpngwgui-host-preparation -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo 'OK current state directory: empty and safe for reuse'
else
  echo 'NG current state directory: state or unexpected content exists'
fi
check_absent 'current sysctl file' /etc/sysctl.d/99-vpngwgui-host-preparation.conf
for path in /etc/sysctl.d/.vpngwgui-sysctl.*.tmp /etc/systemd/system/.vpngwgui-host-reboot*.tmp; do if [ -e "$path" ] || [ -L "$path" ]; then echo "NG handler temporary file exists: $path"; else echo "OK handler temporary file absent: $path"; fi; done
for path in /var/lib/vpngwgui-host-preparation/.state.json.* /var/lib/vpngwgui-host-preparation/.state-sysctl.*.tmp /var/lib/vpngwgui-host-preparation/.state-boot-guard.* /var/lib/vpngwgui-host-preparation/.state-host-reboot*.tmp /var/lib/vpngwgui-host-preparation/.boot-guard-* /var/lib/vpngwgui-host-preparation/.host-reboot-check.*.tmp; do if [ -e "$path" ] || [ -L "$path" ]; then echo "NG handler temporary file exists: $path"; else echo "OK handler temporary file absent: $path"; fi; done
for path in /etc/systemd/system/.vpngwgui-boot-guard*.tmp /etc/vpngwgui/.vpngwgui-boot-guard-update.*.tmp /usr/local/libexec/.vpngwgui-host-reboot*.tmp; do if [ -e "$path" ] || [ -L "$path" ]; then echo "NG handler temporary file exists: $path"; else echo "OK handler temporary file absent: $path"; fi; done
check_absent 'current boot guard unit' /etc/systemd/system/vpngwgui-boot-guard.service
check_absent 'current boot guard multi-user link' /etc/systemd/system/multi-user.target.wants/vpngwgui-boot-guard.service
check_absent 'current Docker dependency link' /etc/systemd/system/docker.service.requires/vpngwgui-boot-guard.service
check_absent 'current boot guard rules file' /etc/vpngwgui/boot-guard.nft
if [ ! -e /etc/vpngwgui ] && [ ! -L /etc/vpngwgui ]; then echo 'OK /etc/vpngwgui: absent'; elif [ -d /etc/vpngwgui ] && [ ! -L /etc/vpngwgui ] && [ -z "$(find /etc/vpngwgui -mindepth 1 -maxdepth 1 -print -quit)" ]; then echo 'OK /etc/vpngwgui: empty parent directory'; else echo 'NG /etc/vpngwgui: inspect and retain/clean each owned entry'; fi
check_table_absent 'current guard table' inet vpngwgui_guard
check_absent 'current host-control directory' /var/lib/vpngwgui-host-ctl
check_absent 'current reboot helper' /usr/local/libexec/vpngwgui-host-reboot
check_absent 'current reboot path unit' /etc/systemd/system/vpngwgui-host-reboot.path
check_absent 'current reboot service unit' /etc/systemd/system/vpngwgui-host-reboot.service
check_absent 'current reboot enable link' /etc/systemd/system/multi-user.target.wants/vpngwgui-host-reboot.path
check_absent 'current reboot spool' /var/lib/vpngwgui-host-reboot-spool
for path in /var/lib/vpngwgui-host-ctl/.reboot-request.tmp.*; do if [ -e "$path" ] || [ -L "$path" ]; then echo "NG reboot request temporary file exists: $path"; else echo "OK reboot request temporary file absent: $path"; fi; done
for path in /var/lib/vpngwgui-host-reboot-spool/* /var/lib/vpngwgui-host-reboot-spool/.[!.]* /var/lib/vpngwgui-host-reboot-spool/..?*; do if [ -e "$path" ] || [ -L "$path" ]; then echo "NG reboot spool entry exists: $path"; else echo "OK reboot spool entry absent: $path"; fi; done
check_unit_absent 'current boot guard unit state' vpngwgui-boot-guard.service /etc/systemd/system/vpngwgui-boot-guard.service
check_unit_absent 'legacy same-name boot guard occupant' vpngwgui-boot-guard.service /etc/systemd/system/vpngwgui-boot-guard.service
check_unit_absent 'current reboot path unit state' vpngwgui-host-reboot.path /etc/systemd/system/vpngwgui-host-reboot.path
check_unit_absent 'legacy reboot path unit' vpngwgui-reboot.path /etc/systemd/system/vpngwgui-reboot.path
check_unit_absent 'legacy reboot service unit' vpngwgui-reboot.service /etc/systemd/system/vpngwgui-reboot.service
check_absent 'legacy sysctl file' /etc/sysctl.d/99-vpngwgui.conf
check_absent 'legacy host-control runtime mount' /var/run/vpngw-host-ctl
check_absent 'legacy host-control directory' /var/lib/vpngwgui-host-ctl
check_absent 'legacy control command' /usr/local/bin/vpngwgui-ctl
check_absent 'legacy installer directory' /opt/vpngwgui
check_absent 'legacy configuration file' /etc/vpngwgui/vpngwgui.env
check_absent 'legacy PKI directory' /etc/vpngwgui/pki
check_absent 'legacy E2E CA bundle' /etc/vpngwgui/e2e-ca-bundle.crt
check_table_absent 'legacy Gateway table' inet vpngwgui
if getent passwd 10001 >/dev/null 2>&1; then echo 'NG UID 10001 is allocated'; else echo 'OK UID 10001 is free'; fi
if getent group 10001 >/dev/null 2>&1; then echo 'NG GID 10001 is allocated'; else echo 'OK GID 10001 is free'; fi
if docker ps -a --filter label=com.docker.compose.project=vpngwgui --format '{{.Names}}' | grep . >/dev/null; then echo 'NG old/current vpngwgui containers exist'; else echo 'OK no vpngwgui containers'; fi
if docker volume ls --filter label=com.docker.compose.project=vpngwgui --format '{{.Name}}' | grep . >/dev/null; then echo 'NG vpngwgui volumes exist (review; preserve unless old project confirmed)'; else echo 'OK no vpngwgui volumes'; fi
if docker network ls --filter label=com.docker.compose.project=vpngwgui --format '{{.Name}}' | grep . >/dev/null; then echo 'NG vpngwgui networks exist (review; preserve unless old project confirmed)'; else echo 'OK no vpngwgui networks'; fi
for port in 18080 8443; do if ss -ltn "sport = :$port" | tail -n +2 | grep . >/dev/null; then echo "NG TCP port $port is listening"; else echo "OK TCP port $port is free"; fi; done
CHECKER
```

## 6. 7.3 nftables の構文・時間・評価順序・通信経路

各ケースの準備・設定、`lan` namespace で実行したコマンド、期待する応答または遮断、実測結果、時刻、nft ruleset/status 出力、合否を記録する。サービス起動前に、ルールを適用せず nft 構文を検査する。コンテナの root shell で実行する。

```sh
cat > /tmp/vpngwgui-nft-check.nft <<'NFT'
add table inet vpngwgui_syntax_check
add set inet vpngwgui_syntax_check healthy_lease4 { type ifname; flags timeout; }
add chain inet vpngwgui_syntax_check guard_forward { type filter hook forward priority -1; policy accept; }
add rule inet vpngwgui_syntax_check guard_forward iifname @healthy_lease4 return
add rule inet vpngwgui_syntax_check guard_forward iifname "e2eseg" drop
add chain inet vpngwgui_syntax_check gateway_forward { type filter hook forward priority 0; policy accept; }
NFT
nft -c -f /tmp/vpngwgui-nft-check.nft
unlink /tmp/vpngwgui-nft-check.nft
```

一時 batch は製品と同じ timeout set、priority `-1 return` / drop、priority `0` chain 構文を検査する。`-c` は構文だけを検査し、rule は適用しない。実際の Gateway table は起動後に `nft list table inet vpngwgui` で確認する。期限付き set に4秒の要素を追加し、期限前に更新して timer が再開することを確認する。その後、明示削除せず自然に期限切れするまで観測する。Gateway 所有の table は製品操作経由で扱い、再作成試験のために独立した guard table を削除しない。

7.3 の期限付き set 操作例:

```sh
nft add element inet vpngwgui_guard healthy_lease4 { "e2eseg" timeout 4s }
sleep 2
nft replace element inet vpngwgui_guard healthy_lease4 { "e2eseg" timeout 4s }
nft list set inet vpngwgui_guard healthy_lease4
sleep 4
nft list set inet vpngwgui_guard healthy_lease4
```

ここでは guard の `healthy_lease4` set を観察する。set の element を2秒後に更新し、更新後4秒を超えてから listing で自然 expiry を確認する。Gateway lease 更新ループが稼働中のままでは製品が再投入するため、mock proxy を停止した測定専用区間で行い、終了後 clean snapshot に戻す。

各 traffic path は `gatewayGuard.state=LEASE` の正常通過と、同じ設定で `BLOCK` にした遮断の両方を実行する。BLOCK 時の DNAT-ed forward、DNS redirect、bypass、VPN forward は LAN probe が失敗し、guard table に `iifname "e2eseg" drop` rule が適用されていることを確認する。nft trace を有効にして採取した場合は packet trace も添える。結果には成功系・遮断系それぞれの command と probe 時刻を分けて記録する。

| 確認項目 | 準備と `lan` namespace でのコマンド | 期待する観測・記録内容 |
|---|---|---|
| 期限付き set | Gateway API で redirect / lease の期限付き set に試験要素を追加し、LAN から250 msごとに照会する。 | 更新後は要素が残り、最後の更新から約4秒後に自然消滅する。追加・更新・最終確認・期限切れ時刻と `nft list set` を記録する。 |
| ルール順序 | guard が BLOCK の状態で `nft -a list table inet vpngwgui_guard` と Gateway forward chain を確認する。 | guard chain は priority `-1` で、許可対象の established / DNAT 通信に `return` し、priority `0` の Gateway 評価より先に動く。handle と priority を記録する。priority `-1 return` は priority `0` へ評価を続ける動作であり、packet の accept ではない。 |
| DNAT forward | Web を起動し、transparent Gateway と Kill Switch を有効にする。`ip netns exec lan curl --max-time 3 -sS -o /dev/null -w '%{http_code}\\n' http://192.168.50.1:18080/` | service 正常時は HTTP 200。`nft list chain inet vpngwgui forward` で DNAT 例外を確認して記録する。 |
| DNS redirect | DNS relay と redirect を有効にする。`ip netns exec lan dig +time=2 +tries=1 @192.168.50.1 example.com A` | 問い合わせが `DNS_RELAY_PORT=5353` の relay に届く。応答、relay log、`nft list set inet vpngwgui redirected4` を記録する。redirect を無効にした対照問い合わせが ISP に直接届くことも確認する。 |
| bypass | 専用 ISP endpoint に解決される試験 domain の bypass を有効にし、`ip netns exec lan curl --cacert e2e/hosted/.work/certs/ca.crt --max-time 3 -v https://198.51.100.253/` を実行する（provision した ISP service の endpoint / port を使う）。 | bypass set、mark chain、`ip rule`、table 100 route、ISP 側 packet / log と応答を確認して記録する。nft rule の存在だけで合格と判断しない。 |
| VPN forward | hosted mock stack で mock VPN を接続し、`vpn0` の存在を確認してから `ip netns exec lan curl --cacert e2e/hosted/.work/certs/ca.crt --max-time 3 -sS -o /dev/null -w '%{http_code}\\n' https://198.51.100.254/` を実行する（または設定済み ISP echo endpoint を使う）。 | LAN → Gateway → vpn0 / vpnexit → ISP を往復する。`ip -4 route`、tunnel address、`nft list table inet vpngwgui`、ISP log / 観測送信元と応答を記録する。mock の route 変更はこのコンテナ内に限られる。 |
| Gateway table 再作成 | guard が BLOCK / LEASE のときに Gateway 設定を変更するか proxy を再起動し、table の再構成を発生させる。 | `inet vpngwgui` が再作成され、guard table `inet vpngwgui_guard` と BLOCK / lease が維持される。両 table の前後状態と Gateway status route を記録する。 |

`topology.sh` が `lan` を `192.168.50.10/24`、gateway を `192.168.50.1` として作る。ISP と VPN exit の mock endpoint は `198.51.100.254` / `198.51.100.253` で、routing も topology 内に閉じる。`env.sh` を読み込んでから `/root/vpngwgui` 内で helper を呼ぶ。`topology_up` は `e2eseg`、`lan`、`isp`、`vpnexit`、tunnel veth を作り、container 内の default route だけを変更する。`provision.sh` は mock service と Compose stack を起動できる。root Compose の mock fragment は vendor fragment の後ろに置く。

Node.js 22+ と npm を用意して `npm ci --no-audit --no-fund` を完了した後、`/root/vpngwgui` で hosted helper を次の順に実行する。container の route を変更するのは `topology_route_isp` の箇所である。

```sh
cd /root/vpngwgui
npm ci --no-audit --no-fund
. e2e/hosted/lib/env.sh
. e2e/hosted/lib/topology.sh
. e2e/hosted/lib/provision.sh
topology_links
provision_start
provision_isp_start
topology_route_isp
provision_wait
```

## 7. 7.4 Kill Switch の停止・障害時動作

Kill Switch の true / false と停止方法を組み合わせる。異常終了は `docker kill -s KILL <proxy>`、hang は `docker pause <proxy>`（SIGSTOP を個別に見る場合は `docker exec <proxy> ... kill -STOP 1`）、通常停止は `docker stop <proxy>` を使う。`docker compose -p vpngwgui ps --format json` / `docker compose ps` で実際の container 名を調べ、生成名の suffix を決め打ちしない。測定中に限って自動再起動を無効にし、次のケース前に元の restart policy に戻す。

`lan` namespace から timestamp 付き TCP connect または `ping -D` を millisecond resolution で測る。停止操作を行っている間も probe loop を継続する。TCP loop の例:

```sh
ip netns exec lan sh -c 'while :; do date +%s.%3N; curl --connect-timeout 0.5 --max-time 0.8 -sS -o /dev/null -w "HTTP %{http_code}\\n" http://192.168.50.1:18080/ || echo CONNECT_FAILED; sleep 0.1; done' | tee /root/vpngwgui-killswitch-probe.log
```

Kill Switch true では3種類すべての停止で6秒以内に遮断すること。停止要求時刻、最後の成功 probe、連続失敗に変わった最初の probe、経過 millisecond、guard state / lease、log、停止順序を記録する。通常停止では proxy 終了前に Gateway が BLOCK へ移ることと、lease 期限切れが最後の遮断手段になることを確かめる。Kill Switch false では、どの停止方法でも guard による遮断が有効にならないこと。試験経路が継続到達するか、別要因の失敗かを分けて記録する。各ケースの間に service と正常状態を復旧する。

Gateway 停止中に認証済み `PUT /api/v1/connection/config` を送る。HTTP 503 と `kill_switch_not_applied` を期待する。`GET /api/v1/connection/config` で永続設定を前後に読み、値が変わらないことを確認する。Gateway 再起動後に PUT を再試行し、変更が適用されることを確かめる。コンテナ shell は root のため、sudo なしで guard state を読む:

```sh
nft list table inet vpngwgui_guard
# 認証済み UI/API セッションで GET /api/v1/connection/gateway を開く
```

認証済み API route `GET /api/v1/connection/gateway` は Gateway の `GET /net/status` を中継する。この応答から `gatewayGuard.state`、`healthy`、`leaseValid`、`lastUpdatedAt` を記録する。nft table の直接表示は kernel 側 guard の証拠となる。TLS 有効時は設定済み UDS mTLS を通る認証 API / UI route から読む。

## 8. 7.5 ライフサイクル・データ保持・host-preparation・コンテナ再起動

すべての lifecycle 操作で `docker compose -p vpngwgui` を使い、root / vendor / mock の `COMPOSE_FILE` 順序を維持する。

```sh
cd /root/vpngwgui
docker compose -p vpngwgui config --quiet
docker compose -p vpngwgui up -d --build
docker compose -p vpngwgui stop
docker compose -p vpngwgui start
docker compose -p vpngwgui restart
docker compose -p vpngwgui up -d --force-recreate
docker compose -p vpngwgui down
# データ削除を確認する専用試験の場合だけ実行する
docker compose -p vpngwgui down -v
```

host-preparation の操作もコンテナ内で行う。

```sh
cd /root/vpngwgui
sh compose/host-preparation.sh check
sh compose/host-preparation.sh apply
sh compose/host-preparation.sh status
systemd-analyze critical-chain docker.service
systemctl show -p RequiredBy,Before,After docker.service vpngwgui-boot-guard.service
nft list table inet vpngwgui_guard
```


1. 初回起動: topology の `topology_links` を実行し、bundle の `docker compose -p vpngwgui config --quiet` と `up -d --build` を実行してから `provision_wait` を使う。health、`LAN_IFACE=e2eseg`、network / table、初期 named volume を確認する。
2. 更新: project を停止し、§4.1 の checksum 検証・展開・`lxc file push --recursive` を新しい版で繰り返して `/root/vpngwgui` に再展開する（`.env` と別途配置した E2E 資材は保持する）。`config --quiet`、`up -d --build` を実行し、image / version と保持されたデータを記録する。
3. 停止・再作成: `docker compose -p vpngwgui stop` / `start`、`restart`、`up -d --force-recreate` を比較し、named volume のデータと API 設定が保持されることを確認する。
4. volume 削除試験: 期待するデータを記録してから `docker compose -p vpngwgui down -v` を実行し、named volume が削除され、次の `up` でデータが初期化されることを確認する。project volume を意図して消すのはこの手順だけとする。
5. vendor fragment: 両 vendor を追加した状態で service と volume を確認する。`down` の後に片方の vendor fragment を外して `up` し、元の順序で再度追加して `up` する。fragment を外している間も専用 named volume にデータが残り、再追加後に再利用されることを記録する。
6. host-preparation: コンテナ内 project root から `sh compose/host-preparation.sh check`、`apply`、`status` を実行し、state file、sysctl、guard と Docker の順序を記録する。コンテナ内で製品所有値を変更して ownership drift を起こし、`status` の drift / `remove` の conflict を確認する。外部変更値が上書きされないことを確かめ、cleanup 前に試験で変更した値だけを戻す。サーバ本体では apply / remove しない。
7. 起動順序: host-preparation 適用後、必要に応じて stack を停止し、次の reboot procedure でコンテナを再起動する。コンテナ内で `systemd-analyze critical-chain docker.service`、`systemctl show -p RequiredBy,Before,After docker.service vpngwgui-boot-guard.service`、`nft list table inet vpngwgui_guard` を確認する。Docker 起動前に guard BLOCK が存在することを確認し、journal と unit 順序の出力を保存する。
8. reboot request 経路: Web / API route 経由で認証済み `POST /api/v1/gateway/reboot` を送り、製品の再起動を要求する。path / service が固定形式の要求を検査・消費し、この system container 内で systemd reboot を呼ぶ。結果は `lxc restart acc-vpngwgui` として扱い、物理サーバは再起動しない。systemd / network / Docker の復帰を待ち、`lxc exec` で再接続する。Docker より先に boot guard BLOCK があること、stack が復旧すること、request file が消費されることを確認する。

各段階の前後で operator / settings data、provider config、bypass / DNS settings、volume 名、生成した証明書の保持状態を記録する。明示した削除試験以外で `down -v` を使わない。最後に container を削除する前に、コンテナ内で Compose down と host-preparation `remove` を実行し、受入結果をコンテナ外に保存する。

## 9. 7.6 TLS 組み合わせと異常系

TLS 証明書は短期間の試験資材である。別途配置した helper を使い、コンテナ内の lab 専用 directory に生成する。製品用の鍵を転送しない。`e2e/hosted/lib/tls-matrix-certs.sh` は Web / Gateway CA、server / client 証明書、wrong-CA、SAN 不一致、期限切れ証明書と `invalid/no-client/` 用 directory を作る。Compose の host path は `/root/vpngwgui/.work/tls-matrix/...` とし、Web HTTPS には `compose/web-tls.yml`、API↔Gateway mTLS には `compose/api-tls.yml` を root / vendor / mock fragment の後ろに追加する。Web は `web/server.crt` と `web/server.key` を使う。API TLS fragment は Gateway CA と `api-client.crt/key` を API に、Gateway server `server.crt/key` を proxy に mount する。

試験証明書を生成して設定する:

```sh
cd /root/vpngwgui
sh e2e/hosted/lib/tls-matrix-certs.sh /root/vpngwgui/.work/tls-matrix
export WEB_TLS_CERT_HOST_PATH=/root/vpngwgui/.work/tls-matrix/web/server.crt
export WEB_TLS_KEY_HOST_PATH=/root/vpngwgui/.work/tls-matrix/web/server.key
export GATEWAY_TLS_CA_HOST_PATH=/root/vpngwgui/.work/tls-matrix/gateway/ca.crt
export GATEWAY_TLS_CLIENT_CERT_HOST_PATH=/root/vpngwgui/.work/tls-matrix/gateway/api-client.crt
export GATEWAY_TLS_CLIENT_KEY_HOST_PATH=/root/vpngwgui/.work/tls-matrix/gateway/api-client.key
export GATEWAY_TLS_SERVER_CERT_HOST_PATH=/root/vpngwgui/.work/tls-matrix/gateway/server.crt
export GATEWAY_TLS_SERVER_KEY_HOST_PATH=/root/vpngwgui/.work/tls-matrix/gateway/server.key
export GATEWAY_TLS_SERVER_NAME=gateway.local
```

各ケースの前に停止し、両 flag と Compose fragment を一致させて `config --quiet`、`up -d --build` を実行する。その後 `docker compose -p vpngwgui logs api`、`ps`、Gateway status route、`curl --cacert` の結果を確認する。Web TLS 有効時は Web CA を使って `https://localhost:18080/` を確認し、同じ HTTPS listener への平文 HTTP が拒否されることを確かめる。無効時は `http://127.0.0.1:18080/` が成功すること。valid TLS では Gateway status が成功し、不正設定では期待した 502 / error を示すこと。

| Web HTTPS | Gateway mTLS | 追加する Compose fragment | 期待結果 |
|---|---|---|---|
| false | false | なし | HTTP Web と Gateway status が成功する。 |
| true | false | `compose/web-tls.yml` | Web CA で検証できる HTTPS が成功し、同 port の平文 HTTP は拒否、Gateway status は成功する。 |
| false | true | `compose/api-tls.yml` | HTTP Web と mTLS 経由の API↔Gateway status が成功する。 |
| true | true | TLS fragment 両方 | 信頼済み HTTPS と Gateway mTLS status が成功し、平文 HTTP は拒否される。 |

次の関数は4つの有効構成を順に切り替える。証明書環境変数は上の生成 block の値を保持する。

```sh
BASE_COMPOSE=docker-compose.yml:vendors/protonvpn/compose.yml:vendors/adguardvpn/compose.yml:docker-compose.e2e-mock.yml
run_tls_case() {
  files=$1; web=$2; gateway=$3
  COMPOSE_FILE="$files" WEB_HTTPS_ENABLED="$web" GATEWAY_TLS_ENABLED="$gateway" docker compose -p vpngwgui down
  COMPOSE_FILE="$files" WEB_HTTPS_ENABLED="$web" GATEWAY_TLS_ENABLED="$gateway" docker compose -p vpngwgui config --quiet
  COMPOSE_FILE="$files" WEB_HTTPS_ENABLED="$web" GATEWAY_TLS_ENABLED="$gateway" docker compose -p vpngwgui up -d --build
  docker compose -p vpngwgui logs --since 2m api
}
run_tls_case "$BASE_COMPOSE" false false
run_tls_case "$BASE_COMPOSE:compose/web-tls.yml" true false
run_tls_case "$BASE_COMPOSE:compose/api-tls.yml" false true
run_tls_case "$BASE_COMPOSE:compose/web-tls.yml:compose/api-tls.yml" true true
```

不正証明書の各試験では Web TLS を無効、Gateway TLS を有効にする。毎回停止・再作成し、API log と Gateway status の結果を保存する。

| 試験 | 入力と期待する観測 |
|---|---|
| CA 不一致 | `invalid/wrong-ca-server.crt` と `.key`。Gateway 要求は TLS 検証に失敗し、API log に trust failure、status route に proxy unavailable / 502 が出て、HTTP へ降格しない。 |
| 期限切れ | `invalid/expired-server.crt` と `.key`。API log に証明書期限切れ、status に 502 が出て、降格しない。 |
| SAN 不一致 | `invalid/san-mismatch.crt` と `.key` を使い、server name は `gateway.local` のままにする。API log に hostname 検証失敗、status に 502 が出る。 |
| client 証明書なし | 最後の API override で `GATEWAY_TLS_CLIENT_CERT_FILE` と `GATEWAY_TLS_CLIENT_KEY_FILE` を空にする。API は起動または設定検証に失敗する。`docker compose -p vpngwgui logs api` と `ps` で確認する。 |

各不正証明書は次のように server cert/key の host path を一つずつ切り替え、上の `run_tls_case "$BASE_COMPOSE:compose/api-tls.yml" false true` を実行する。

```sh
export GATEWAY_TLS_SERVER_CERT_HOST_PATH=/root/vpngwgui/.work/tls-matrix/invalid/wrong-ca-server.crt
export GATEWAY_TLS_SERVER_KEY_HOST_PATH=/root/vpngwgui/.work/tls-matrix/invalid/wrong-ca-server.key
run_tls_case "$BASE_COMPOSE:compose/api-tls.yml" false true
export GATEWAY_TLS_SERVER_CERT_HOST_PATH=/root/vpngwgui/.work/tls-matrix/invalid/expired-server.crt
export GATEWAY_TLS_SERVER_KEY_HOST_PATH=/root/vpngwgui/.work/tls-matrix/invalid/expired-server.key
run_tls_case "$BASE_COMPOSE:compose/api-tls.yml" false true
export GATEWAY_TLS_SERVER_CERT_HOST_PATH=/root/vpngwgui/.work/tls-matrix/invalid/san-mismatch.crt
export GATEWAY_TLS_SERVER_KEY_HOST_PATH=/root/vpngwgui/.work/tls-matrix/invalid/san-mismatch.key
run_tls_case "$BASE_COMPOSE:compose/api-tls.yml" false true
export GATEWAY_TLS_SERVER_CERT_HOST_PATH=/root/vpngwgui/.work/tls-matrix/gateway/server.crt
export GATEWAY_TLS_SERVER_KEY_HOST_PATH=/root/vpngwgui/.work/tls-matrix/gateway/server.key
cat > /root/vpngwgui/.work/tls-matrix/missing-client-override.yml <<'YAML'
services:
  api:
    environment:
      GATEWAY_TLS_CLIENT_CERT_FILE: ''
      GATEWAY_TLS_CLIENT_KEY_FILE: ''
YAML
run_tls_case "$BASE_COMPOSE:compose/api-tls.yml:/root/vpngwgui/.work/tls-matrix/missing-client-override.yml" false true
```

保護方式の不一致も確認する。API / Gateway の一方だけ TLS flag を有効にし、有効側に対応する fragment だけを追加する。Gateway status に保護方式不一致 (`gateway_protection_mismatch`) が現れ、log / status に平文 fallback がないことを確認する。flag / fragment の組み合わせと HTTP status を記録する。各異常系の後、次のケース前に有効な証明書 path に戻す。

## 10. 安全確認

- container `acc-vpngwgui` と、その内部の Compose project `vpngwgui` だけを使う。
- 検証サーバ本体では `topology.sh` や host-preparation を実行しない。topology の route 変更はコンテナ内に限る。
- サーバの旧 stack、unit、nftables、sysctl、filesystem には触れない。コンテナ namespace の変更で SSH route は変わらない。
- nested build の前後に `df -h /`、`lxc storage info default`、container 内の空き容量を確認し、終了時に container を削除する。
- mock VPN だけを使い、実 VPN credentials は入力・使用しない。
- この文書や受入結果に認証情報、製品用秘密鍵、認証値を記載しない。
- 独立した受入 run の間で clean snapshot を復元し、lab 削除前に結果を保存する。

## 11. 結果記録のテンプレート

`.kiro/specs/single-node-deployment/acceptance-results.md` に 7.3、7.4、7.5、7.6 の節を作る。各確認について command / setup、UTC timestamp、期待結果、実測結果、pass/fail、制限事項または follow-up を記録する。

```markdown
# 実機受入結果

- Lab: `acc-vpngwgui` (Ubuntu 24.04.5; shared server kernel 6.8.0-149)
- Bundle 版 / checksum:
- mock 資材 tarball checksum:
- 開始 / 終了 (UTC):

## 7.3 nftables / 通信経路
| 確認項目 | command / setup | UTC timestamp | 期待結果 | 実測結果 | pass/fail |
|---|---|---|---|---|---|

## 7.4 Kill Switch
| Kill Switch | 停止方法 | command / probe | UTC timestamp | 遮断時間 / 期待値 | 実測結果 | pass/fail |
|---|---|---|---|---|---|---|

## 7.5 ライフサイクル / host-preparation / 再起動
| 確認項目 | command / setup | UTC timestamp | 期待結果 | 実測結果 | pass/fail |
|---|---|---|---|---|---|

## 7.6 TLS
| 組み合わせ / 試験 | command / setup | UTC timestamp | 期待結果 | 実測結果 | pass/fail |
|---|---|---|---|---|---|
```
