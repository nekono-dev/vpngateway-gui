import { useRef, type PointerEvent, type ReactNode } from "react";
import {
  getLocationBackLabel,
  shouldSwipeBack,
  type LocationBrowserScreen,
} from "./location-browser-state";

interface Props {
  screen: LocationBrowserScreen;
  parentName?: string;
  onBack: () => void;
  children?: ReactNode;
}

/** 一覧上部の戻る操作とタブを、同じ左詰めの行に表示する。 */
export function LocationBackBar({ screen, parentName, onBack, children }: Props) {
  const startRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const label = getLocationBackLabel(screen, parentName);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    suppressClickRef.current = false;
    startRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    // 子ボタンの click が親へ再配送されないよう、押した要素で捕捉する。
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (startRef.current?.pointerId !== event.pointerId) return;
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    startRef.current = null;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) > Math.abs(deltaY) && shouldSwipeBack(screen, deltaX)) {
      suppressClickRef.current = true;
      onBack();
    }
  };

  return (
    <div
      className="location-back-bar flex items-center justify-start gap-0 m-0 p-0"
      style={{ touchAction: "pan-y" }}
      onClickCapture={(event) => {
        // スワイプ直後の合成 click で二階層戻ることを防ぐ。キーボード操作は通す。
        const suppress = suppressClickRef.current;
        suppressClickRef.current = false;
        if (suppress && event.detail > 0) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(event) => {
        if (startRef.current?.pointerId === event.pointerId) startRef.current = null;
      }}
    >
      {label ? (
        <button type="button" className="m-0 p-0" onClick={onBack}>
          {label}
        </button>
      ) : null}
      {children}
    </div>
  );
}
