#!/bin/sh
# 責務: hosted E2E の定数（ブリッジ名、IP 計画、ポート、名前空間の名前）。他のスクリプトは、この値だけを参照する。
# 値を変える場合は design の IP 計画と合わせる（e2e-tests/design.md の Topology）。

E2E_BRIDGE="e2eseg"
E2E_HOST_IP="192.168.50.1"            # ホスト（ブリッジ側）。LAN クライアントの既定の次ホップ
E2E_NET="192.168.50.0/24"
E2E_ISP_IP="192.168.50.254"           # 上位ルータ・echo・DoH・DNS（既定経路の次ホップ）
E2E_LAN_IP="192.168.50.10"            # LAN クライアント
E2E_VPNEXIT_IP="192.168.50.200"       # VPN 出口（LAN 側）
E2E_TUN_HOST="10.66.0.1/30"           # VPN トンネル（ホスト側 vpn0）
E2E_TUN_EXIT="10.66.0.2/30"           # VPN トンネル（出口側）

E2E_NS_LAN="lan"
E2E_NS_ISP="isp"
E2E_NS_VPNEXIT="vpnexit"

E2E_WEB_PORT="18080"                  # Web UI（ホストのポート）
E2E_ECHO_PORT="443"
E2E_DOH_PORT="443"

# 既定経路の退避先（topology_up が書き、topology_down が読む）。git の対象外の作業場所
E2E_WORK_DIR="${E2E_WORK_DIR:-e2e/hosted/.work}"
E2E_ROUTE_FILE="$E2E_WORK_DIR/default-route.txt"
