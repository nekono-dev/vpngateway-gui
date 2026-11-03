#!/bin/sh
# 責務: hosted runner の E2E で使うテスト用の CA と、ISP（198.51.100.254）のサーバ証明書を、実行ごとに作り直す（要件 5.1・8.6）。
# 秘密鍵はリポジトリに含めない。出力先は引数で受け取る（既定は e2e/hosted/.work/certs。git の対象外）。
#
# 使い方: sh e2e/hosted/lib/certs.sh [出力先ディレクトリ]
# 出力: ca.crt（検証に使う CA）、ca.key、server.crt、server.key
# 失敗時の方針: 途中で失敗したら set -e で止まり、不完全な証明書を次の工程へ渡さない。

set -eu

OUT="${1:-e2e/hosted/.work/certs}"
ISP_IP="198.51.100.254"

# 実行ごとに作り直すため、古い出力を消してから作る
rm -rf "$OUT"
mkdir -p "$OUT"
cd "$OUT"

# テスト用の CA（有効期間は 1 日。実行の都度作るため十分）
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -keyout ca.key -out ca.crt -days 1 -subj "/CN=vpngwgui-e2e-test-ca" 2>/dev/null

# サーバ証明書。SAN に ISP の IP を含める（ローカルの単体確認のため 127.0.0.1 も含める）
printf 'subjectAltName=IP:%s,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$ISP_IP" > server.ext
openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -keyout server.key -out server.csr -subj "/CN=$ISP_IP" 2>/dev/null
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 1 -extfile server.ext 2>/dev/null

rm -f server.csr server.ext ca.srl

# 生成物の検証: サーバ証明書が、今作った CA から検証できること
openssl verify -CAfile ca.crt server.crt >/dev/null
echo "証明書を生成した: $OUT（CA から検証できることを確認）"
