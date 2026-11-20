# 手動の実 VPN 試験

この試験は開発者の端末から手動で実行する。CI 環境からの起動は拒否され、VPN 資格情報は設定ファイルや成果物へ保存しない。

`config.local.json` に製品の Web 公開 origin を指定する。Web HTTPS が有効な場合だけ `webCaPath` を任意で指定できる。未指定の場合は Node.js の標準 trust store で検証する。API の URL や API 用 CA は指定しない。

```json
{
  "webBaseUrl": "https://gateway.example.test:8443",
  "webCaPath": "/home/operator/certs/web-ca.pem",
  "artifactsDir": "e2e/artifacts/vendor-live"
}
```

HTTP 構成では `webBaseUrl` を `http://<ホスト>:<ポート>` にし、`webCaPath` は省略する。準備処理と試験の API 操作は Web origin の `/api` 経由で行う。

```sh
npm run test:vendor-live
```
