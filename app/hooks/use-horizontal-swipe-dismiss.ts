"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type SwipeAxis = "horizontal" | "vertical" | null;
type SwipeDirection = "left" | "right";

type SwipeGesture = {
  axis: SwipeAxis;
  lastTime: number;
  lastX: number;
  pointerId: number;
  startTime: number;
  startX: number;
  startY: number;
  velocityX: number;
};

type SwipeDismissOptions = {
  direction: SwipeDirection;
  enabled: boolean;
  onDismiss: () => void;
};

export function useHorizontalSwipeDismiss<T extends HTMLElement>({
  direction,
  enabled,
  onDismiss,
}: SwipeDismissOptions) {
  const gestureRef = useRef<SwipeGesture | null>(null);
  const swipeTriggeredRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [dragX, setDragX] = useState(0);
  const enabledRevisionRef = useRef(0);

  const reset = useCallback(() => {
    gestureRef.current = null;
    setDragging(false);
    setDragX(0);
  }, []);

  useEffect(() => {
    const revision = ++enabledRevisionRef.current;
    gestureRef.current = null;
    if (enabled) swipeTriggeredRef.current = false;
    void Promise.resolve().then(() => {
      if (enabledRevisionRef.current !== revision) return;
      setDragging(false);
      setDragX(0);
    });
  }, [enabled]);

  const onPointerDown = useCallback((event: ReactPointerEvent<T>) => {
    const target = event.target;
    const ignoreTarget = target instanceof Element
      && Boolean(target.closest("input, textarea, select, [data-swipe-dismiss-ignore]"));
    if (!enabled || !event.isPrimary || event.pointerType === "mouse" || ignoreTarget) return;
    swipeTriggeredRef.current = false;
    gestureRef.current = {
      axis: null,
      lastTime: event.timeStamp,
      lastX: event.clientX,
      pointerId: event.pointerId,
      startTime: event.timeStamp,
      startX: event.clientX,
      startY: event.clientY,
      velocityX: 0,
    };
  }, [enabled]);

  const onPointerMove = useCallback((event: ReactPointerEvent<T>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;

    if (!gesture.axis) {
      const distance = Math.hypot(deltaX, deltaY);
      if (distance < 8) return;
      const horizontal = Math.abs(deltaX) > Math.abs(deltaY) * 1.15;
      const vertical = Math.abs(deltaY) > Math.abs(deltaX) * 1.15;
      if (!horizontal && !vertical && distance < 18) return;
      gesture.axis = horizontal || (!vertical && Math.abs(deltaX) > Math.abs(deltaY))
        ? "horizontal"
        : "vertical";
      if (gesture.axis === "vertical") return;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      setDragging(true);
    }

    if (gesture.axis !== "horizontal") return;
    const elapsed = Math.max(1, event.timeStamp - gesture.lastTime);
    gesture.velocityX = (event.clientX - gesture.lastX) / elapsed;
    gesture.lastX = event.clientX;
    gesture.lastTime = event.timeStamp;
    setDragX(direction === "left" ? Math.min(0, deltaX) : Math.max(0, deltaX));
  }, [direction]);

  const onPointerEnd = useCallback((event: ReactPointerEvent<T>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const elapsed = Math.max(1, event.timeStamp - gesture.startTime);
    const directionMultiplier = direction === "left" ? -1 : 1;
    const distance = deltaX * directionMultiplier;
    const fallbackVelocity = distance / elapsed;
    const velocity = Math.max(gesture.velocityX * directionMultiplier, fallbackVelocity);
    const threshold = Math.min(96, event.currentTarget.clientWidth * .25);
    const shouldDismiss = gesture.axis === "horizontal"
      && (distance >= threshold || (distance >= 30 && velocity >= .45));
    swipeTriggeredRef.current = gesture.axis === "horizontal";
    reset();
    if (shouldDismiss) onDismiss();
  }, [direction, onDismiss, reset]);

  const onLostPointerCapture = useCallback((event: ReactPointerEvent<T>) => {
    // Pointer capture may begin on a nested button before moving to the drawer.
    // Ignore that child's bubbling lost-capture event; only the drawer owns this gesture.
    if (event.target !== event.currentTarget) return;
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    swipeTriggeredRef.current = false;
    reset();
  }, [reset]);

  const onPointerCancel = useCallback(() => {
    swipeTriggeredRef.current = false;
    reset();
  }, [reset]);

  const onClickCapture = useCallback((event: ReactMouseEvent<T>) => {
    if (!swipeTriggeredRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    swipeTriggeredRef.current = false;
  }, []);

  return {
    dragX,
    dragging,
    onClickCapture,
    onLostPointerCapture,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
  };
}
