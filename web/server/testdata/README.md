// 責務: Web listener 統合テスト用の証明書 fixture の由来を記録する。

このディレクトリの PEM ファイルは、Web listener の TLS 起動検査だけに使う使い捨ての自己署名証明書と秘密鍵です。実環境では使わず、機密情報を含みません。`web-test.crt` と `web-test.key` はペアで、`other-test.key` は鍵不一致検査用です。証明書の有効期間は長く設定しています。
