// 責務: ネットワークインターフェース名がLinuxカーネルの命名規則上妥当な形式かを判定するのみを行う汎用ヘルパー。
// プロジェクト固有の型・モジュールに依存しない。

// Linuxのインターフェース名はIFNAMSIZ(16バイト、終端NUL含む)未満で、"/"や空白を含まない。
// nftablesルール文字列へインターフェース名をそのまま埋め込む前に、この形式チェックを通す。
const INTERFACE_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,15}$/;

/**
 * 目的: 文字列がLinuxのネットワークインターフェース名として妥当な形式かを判定する。
 * 入力: value(検証対象の文字列)。
 * 出力: 妥当な形式であれば true。
 * 例: isValidInterfaceName("tun0") // => true
 *     isValidInterfaceName("eth0; rm -rf /") // => false
 */
export function isValidInterfaceName(value: string): boolean {
  return INTERFACE_NAME_PATTERN.test(value);
}
