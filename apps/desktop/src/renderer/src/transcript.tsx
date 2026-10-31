import { ArrowDown } from "@phosphor-icons/react/ArrowDown";
import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

export function Transcript({
  viewKey,
  live,
  preservePosition,
  followRequest,
  children,
}: {
  viewKey: string;
  live: boolean;
  preservePosition: boolean;
  followRequest: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const area = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(!preservePosition && live);
  const lastRequest = useRef(followRequest);
  const frame = useRef<number | undefined>(undefined);
  const [jumpVisible, setJumpVisible] = useState(false);
  const update = useCallback(() => {
    const element = area.current;
    if (!element) return;
    if (following.current) element.scrollTop = element.scrollHeight;
    setJumpVisible(
      element.scrollHeight - element.clientHeight - element.scrollTop > 48,
    );
  }, []);
  const jump = useCallback(() => {
    following.current = true;
    update();
  }, [update]);
  useLayoutEffect(() => {
    const element = area.current;
    const inner = content.current;
    if (!element || !inner) return;
    const schedule = () => {
      if (frame.current !== undefined) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        update();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    observer.observe(inner);
    const mutations = new MutationObserver(schedule);
    mutations.observe(inner, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    const pause = () => {
      following.current = false;
    };
    const wheel = (event: WheelEvent) => {
      if (event.deltaY < 0) pause();
    };
    element.addEventListener("wheel", wheel, { passive: true });
    element.addEventListener("load", schedule, true);
    schedule();
    return () => {
      observer.disconnect();
      mutations.disconnect();
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("load", schedule, true);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    };
  }, [update]);
  useLayoutEffect(() => {
    if (lastRequest.current === followRequest) return;
    lastRequest.current = followRequest;
    if (live) jump();
  }, [followRequest, live, jump]);
  return (
    <>
      <section
        ref={area}
        className="live-transcript"
        data-view-session={viewKey}
        aria-label={t("messages.transcript")}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the named conversation region.
        tabIndex={0}
        onScroll={() => {
          const element = area.current;
          if (element) {
            following.current =
              element.scrollHeight - element.clientHeight - element.scrollTop <=
              48;
            setJumpVisible(!following.current);
          }
        }}
        onKeyDown={(event) => {
          if (["PageUp", "Home", "ArrowUp"].includes(event.key))
            following.current = false;
        }}
        onPointerDown={(event) => {
          if (
            event.target instanceof HTMLElement &&
            !event.target.closest("button,a,input")
          )
            following.current = false;
        }}
      >
        <div ref={content} className="transcript-content">
          {children}
        </div>
      </section>
      {jumpVisible && (
        <div className="transcript-jump">
          <button type="button" data-testid="jump-latest" onClick={jump}>
            <ArrowDown size={15} aria-hidden="true" />
            {t("messages.jumpLatest")}
          </button>
        </div>
      )}
    </>
  );
}
