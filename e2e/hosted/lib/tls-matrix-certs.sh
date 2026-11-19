#!/bin/sh
# 責務: hosted TLS matrix 用の Web/Gateway 証明書と独立した失敗用証明書を実行ごとに生成する。
# 鍵は指定された作業ディレクトリだけに保存し、リポジトリへ追加しない。

set -eu

OUT=${1:?使い方: tls-matrix-certs.sh 出力先ディレクトリ}
mkdir -p "$OUT/web" "$OUT/gateway" "$OUT/invalid/no-client"
umask 077

make_ca() {
  dir=$1
  name=$2
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -keyout "$dir/ca.key" -out "$dir/ca.crt" -days 2 -subj "/CN=$name" 2>/dev/null
}

make_leaf() {
  dir=$1
  label=$2
  subject=$3
  sans=$4
  usage=$5
  ca_dir=$6
  openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -keyout "$dir/$label.key" -out "$dir/$label.csr" -subj "/CN=$subject" 2>/dev/null
  printf 'subjectAltName=%s\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=%s\n' "$sans" "$usage" > "$dir/$label.ext"
  openssl x509 -req -in "$dir/$label.csr" -CA "$ca_dir/ca.crt" -CAkey "$ca_dir/ca.key" -CAcreateserial \
    -out "$dir/$label.crt" -days 2 -extfile "$dir/$label.ext" 2>/dev/null
  rm -f "$dir/$label.csr" "$dir/$label.ext"
}

make_ca "$OUT/web" "vpngwgui-e2e-web-ca"
make_leaf "$OUT/web" server 127.0.0.1 IP:127.0.0.1,DNS:localhost serverAuth "$OUT/web"

make_ca "$OUT/gateway" "vpngwgui-e2e-gateway-ca"
make_leaf "$OUT/gateway" server gateway.local DNS:gateway.local serverAuth "$OUT/gateway"
make_leaf "$OUT/gateway" api-client vpngwgui-api-client DNS:api-client.local clientAuth "$OUT/gateway"

# 誤った CA は独立した trust anchor として作る。
make_ca "$OUT/invalid" "vpngwgui-e2e-wrong-ca"
make_leaf "$OUT/invalid" wrong-ca-server gateway.local DNS:gateway.local serverAuth "$OUT/invalid"
make_leaf "$OUT/invalid" san-mismatch other-gateway.local DNS:other-gateway.local serverAuth "$OUT/gateway"

# openssl ca の明示日付で実行時刻に依存しない期限切れ証明書を作る。
mkdir -p "$OUT/invalid/ca-db"
: > "$OUT/invalid/ca-db/index.txt"
printf '1000\n' > "$OUT/invalid/ca-db/serial"
cat > "$OUT/invalid/ca.cnf" <<EOF
[ ca ]
default_ca = local_ca
[ local_ca ]
database = $OUT/invalid/ca-db/index.txt
serial = $OUT/invalid/ca-db/serial
new_certs_dir = $OUT/invalid/ca-db
certificate = $OUT/gateway/ca.crt
private_key = $OUT/gateway/ca.key
default_md = sha256
policy = policy_any
unique_subject = no
[ policy_any ]
commonName = supplied
EOF
openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -keyout "$OUT/invalid/expired-server.key" -out "$OUT/invalid/expired-server.csr" \
  -subj "/CN=gateway.local" 2>/dev/null
printf 'subjectAltName=DNS:gateway.local\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth\n' > "$OUT/invalid/expired-server.ext"
openssl ca -batch -config "$OUT/invalid/ca.cnf" -startdate 20200101000000Z -enddate 20200102000000Z \
  -extfile "$OUT/invalid/expired-server.ext" -in "$OUT/invalid/expired-server.csr" \
  -out "$OUT/invalid/expired-server.crt" 2>/dev/null
rm -f "$OUT/invalid/expired-server.csr" "$OUT/invalid/expired-server.ext" "$OUT/invalid/ca.cnf" "$OUT/invalid/ca-db"/*

echo "TLS matrix 証明書を生成した: $OUT"
