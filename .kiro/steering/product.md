# プロダクト概要

## 目的

VPN 接続を複数の LAN 機器で共有するための Web 管理画面付きゲートウェイを提供する。利用者は LAN 機器のゲートウェイまたは明示的プロキシに本製品のノードを指定し、Web UI から接続先やネットワーク機能を管理する。

## 中核機能

- 複数の VPN runner を同じ Compose project で起動し、Web UI から切り替える。
- LAN 通信を VPN へ転送する透過ゲートウェイと、機器向けの明示的プロキシを提供する。
- DNS 中継、迂回ドメイン、動作検証を提供する。
- 認証・設定・接続操作を Web UI と API から行う。

## 利用と運用

- Web、API、Gateway、選択した runner は同一の Linux ノードで Docker Compose により動かす。
- Debian 12 以降または Ubuntu 22.04 以降、rootful のローカル Docker Engine と Compose plugin、nftables、systemd を必要とする。
- 導入前に `.env` の `LAN_IFACE` を設定し、host-preparation の `check` と `apply` を実行する。Compose の project 名は `vpngwgui` に固定する。
- Web HTTPS と API→Gateway mTLS は任意で、どちらも既定 OFF。証明書は運用者が準備する。
- Kill Switch は透過ゲートウェイの LAN 転送を対象とする。明示的プロキシのみでは停止時遮断を保証しない。
- 旧方式は未リリースのため、新方式への移行・互換対応・保存データの引き継ぎは提供しない。

## プロダクト上の判断

- 利用者向けの導入・運用手順は README を正とし、Compose と host-preparation の現行挙動に合わせる。
- ベンダー固有の差分は `vendors/<ID>/profile.json` と各 vendor fragment に宣言し、本体へベンダー分岐を増やさない。
