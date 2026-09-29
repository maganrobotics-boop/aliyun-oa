'use client';
import { useEffect, type RefObject } from 'react';

/** Measure the actual navigation and visible viewport, including the soft keyboard. */
export function useOaViewport(nav: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const keys = ['--oa-visible-height', '--oa-visible-top', '--oa-keyboard-inset', '--oa-nav-height'];
    const previous = keys.map(key => root.style.getPropertyValue(key));
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = viewport?.height ?? window.innerHeight;
        const top = viewport?.offsetTop ?? 0;
        const navHeight = nav.current?.getBoundingClientRect().height ?? 0;
        [height, top, Math.max(0, window.innerHeight - height - top), navHeight].forEach((value, index) => root.style.setProperty(keys[index], `${Math.round(value)}px`));
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (nav.current) observer?.observe(nav.current);
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      keys.forEach((key, index) => previous[index] ? root.style.setProperty(key, previous[index]) : root.style.removeProperty(key));
    };
  }, [nav]);
}
