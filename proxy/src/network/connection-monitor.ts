// 責務: VPNトンネル経路の消失（＝切断）を定期的に検知し、GatewayControllerへ現在の接続状態を伝える。
// 明示的な`connect`/`disconnect`実行時（server.tsの/exec完了フック）に加え、VPN側の予期しない切断
// （ネットワーク瞬断・ベンダー側都合の切断等、APIサーバ経由のコマンド実行を伴わない切断）にも追従するための
// 独立した監視処理（proxyserver/design.md「VPN接続状態監視」「障害時の挙動」参照）。

import { getEgressInterface } from "./tunnel-interface.js";
import type { GatewayController } from "./gateway-controller.js";

const DEFAULT_POLL_INTERVAL_MS = 10_000;

/**
 * 目的: 公開インターネット宛の通信の出力インターフェース（`ip route get`、ポリシールーティング込み）が
 *      `lanIface`と異なる場合はVPNトンネル経由（接続中）、同一またはundefinedの場合は未接続とみなし、
 *      GatewayControllerへ反映する。
 * 入力: lanIface(LAN側インターフェース名。未設定の場合は判定不能なので常にundefinedを渡す扱いとする)。
 * 出力: なし（GatewayController.updateVpnInterface()を呼ぶ副作用のみ）。
 * 期待する入力形状: lanIfaceはインストールスクリプトが検出した実在のインターフェース名、またはundefined。
 */
export async function checkConnectionOnce(
  controller: GatewayController,
  lanIface: string | undefined,
): Promise<void> {
  const egressIface = await getEgressInterface();
  const vpnIface = egressIface !== undefined && egressIface !== lanIface ? egressIface : undefined;
  await controller.updateVpnInterface(vpnIface);
}

/**
 * 目的: VPN接続インターフェースの定期監視を開始する。
 * 入力: controller(GatewayController), lanIface(LAN側インターフェース名),
 *      intervalMs(ポーリング間隔ms、省略時10秒)。
 * 出力: 監視を停止するための関数（`clearInterval`相当）。
 * 副作用: `intervalMs`ごとに`ip route get`を実行する。
 * 例: const stop = startConnectionMonitor(controller, "eth0"); // ...; stop();
 */
export function startConnectionMonitor(
  controller: GatewayController,
  lanIface: string | undefined,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    checkConnectionOnce(controller, lanIface).catch(() => {
      // ポーリング失敗（一時的なコマンド実行エラー等）で監視ループ自体を止めない。
      // 次回のポーリングで再試行される。
    });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
