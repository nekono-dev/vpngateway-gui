// 責務: 認証状態に応じて初期設定画面・ログイン画面・ダッシュボード（App）を出し分ける。
// webserver/design.md「利用者認証の実装方針」: 未設定・未ログインの間はダッシュボードをレンダリングしない。

import { useAuth } from "./contexts/AuthContext";
import { SetupPage } from "./components/auth/SetupPage";
import { LoginPage } from "./components/auth/LoginPage";
import { App } from "./App";

export function Root() {
  const { auth, logout } = useAuth();
  switch (auth.status) {
    case "loading":
      return null;
    case "setup":
      return <SetupPage />;
    case "login":
      return <LoginPage />;
    case "authenticated":
      return <App onLogout={() => void logout()} />;
  }
}
