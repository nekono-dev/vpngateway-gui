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
  const label = getLocationBackLabel(screen, parentName);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    startRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
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
    if (Math.abs(deltaX) > Math.abs(deltaY) && shouldSwipeBack(screen, deltaX)) onBack();
  };

  return (
    <div
      className="location-back-bar flex items-center justify-start gap-0 m-0 p-0"
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
