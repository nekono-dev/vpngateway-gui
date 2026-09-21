// 責務: コンポーネントテスト共通の初期化（jest-domマッチャ、テストごとのDOM後始末、jsdom未実装APIの補完）。

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdomは`<dialog>`の`showModal()`/`close()`を実装していないため、`open`属性の切替のみを再現する。
// `close()`では実ブラウザ同様に`close`イベントを発火する（`onClose`ハンドラの検証用）。
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
